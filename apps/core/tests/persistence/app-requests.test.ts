import { Conflict, Internal } from "@ironcage/contracts/schema";
import { RequestId, Sha256 } from "@ironcage/domain";
import { Effect, Schema } from "effect";
import { describe, expect, expectTypeOf, test } from "vitest";

import {
  replayRequest,
  runIdempotentMutation,
  type StoredRequest,
} from "../../src/persistence/app-requests";
import { Postgres, type PostgresService, type SqlExecutor } from "../../src/persistence/postgres";

const requestId = Schema.decodeUnknownSync(RequestId)("018f6b2a-7c4e-7d31-a2f0-3b9d4e8c1a55");
const payloadHash = Schema.decodeUnknownSync(Sha256)("a".repeat(64));
const response = Schema.Struct({ accepted: Schema.Boolean });

const stored: StoredRequest = {
  requestId,
  operation: "sleeve.pause",
  payloadHash,
  response: { accepted: true },
};

const RequestParameters = Schema.Tuple([RequestId]);
const RecordParameters = Schema.Tuple([RequestId, Schema.String, Sha256, Schema.String]);

const memoryPostgres = () => {
  const requests = new Map<RequestId, StoredRequest>();
  const sql: SqlExecutor = {
    query: (operation, _statement, parameters = []) =>
      Effect.sync(() => {
        if (operation === "lock app request") return [];
        if (operation === "read app request") {
          const [id] = Schema.decodeUnknownSync(RequestParameters)(parameters);
          const request = requests.get(id);
          return request === undefined ? [] : [request];
        }
        if (operation === "record app request") {
          const [id, recordedOperation, recordedHash, recordedResponse] =
            Schema.decodeUnknownSync(RecordParameters)(parameters);
          const storedResponse: unknown = JSON.parse(recordedResponse);
          requests.set(id, {
            requestId: id,
            operation: recordedOperation,
            payloadHash: recordedHash,
            response: storedResponse,
          });
          return [];
        }
        throw new Error(`unexpected database operation: ${operation}`);
      }),
  };
  const service: PostgresService = {
    ...sql,
    transaction: (use) => use(sql),
    readTransaction: (use) => use(sql),
  };

  return Postgres.of(service);
};

describe("app request replay", () => {
  test("applies a new mutation once, then replays its recorded response", async () => {
    let applications = 0;
    const mutation = runIdempotentMutation(
      { requestId, operation: stored.operation, payloadHash, response },
      () =>
        Effect.sync(() => {
          applications += 1;
          return { accepted: true };
        }),
    ).pipe(Effect.provideService(Postgres, memoryPostgres()));
    const databaseMutation = runIdempotentMutation(
      { requestId, operation: stored.operation, payloadHash, response },
      (sql) => sql.query("apply mutation", "SELECT true").pipe(Effect.as({ accepted: true })),
    );

    expectTypeOf<Effect.Error<typeof mutation>>().toEqualTypeOf<Conflict | Internal>();
    expectTypeOf<Effect.Error<typeof databaseMutation>>().toEqualTypeOf<Conflict | Internal>();
    await expect(Effect.runPromise(mutation)).resolves.toEqual({ accepted: true });
    await expect(Effect.runPromise(mutation)).resolves.toEqual({ accepted: true });
    expect(applications).toBe(1);
  });

  test("returns the recorded response for the same request", async () => {
    await expect(
      Effect.runPromise(
        replayRequest({
          previous: stored,
          requestId,
          operation: stored.operation,
          payloadHash,
          response,
        }),
      ),
    ).resolves.toEqual({ accepted: true });
  });

  test("rejects a request ID reused for different content", async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        replayRequest({
          previous: stored,
          requestId,
          operation: stored.operation,
          payloadHash: Schema.decodeUnknownSync(Sha256)("b".repeat(64)),
          response,
        }),
      ),
    );

    expect(error).toBeInstanceOf(Conflict);
    if (!(error instanceof Conflict)) throw error;
    expect(error.reason).toBe("RequestIdCollision");
  });

  test("fails loudly when a recorded response no longer matches its schema", async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        replayRequest({
          previous: { ...stored, response: { accepted: "yes" } },
          requestId,
          operation: stored.operation,
          payloadHash,
          response,
        }),
      ),
    );

    expect(error).toBeInstanceOf(Internal);
  });
});

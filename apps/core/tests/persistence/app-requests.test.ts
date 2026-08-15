import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import { Conflict, Internal } from "@ironcage/contracts/schema";
import { RequestId, Sha256 } from "@ironcage/domain";
import { Effect, Schema } from "effect";

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
    execute: (operation, _statement, parameters = []) =>
      Effect.sync(() => {
        if (operation === "lock app request" || operation === "apply mutation") return;
        if (operation === "record app request") {
          const [id, recordedOperation, recordedHash, recordedResponse] =
            Schema.decodeUnknownSync(RecordParameters)(parameters);
          const storedResponse = Schema.decodeUnknownSync(Schema.Json)(
            JSON.parse(recordedResponse),
          );
          requests.set(id, {
            requestId: id,
            operation: recordedOperation,
            payloadHash: recordedHash,
            response: storedResponse,
          });
          return;
        }
        throw new Error(`unexpected database operation: ${operation}`);
      }),
    rows: (operation, schema, _statement, parameters = []) =>
      Effect.sync(() => {
        if (operation !== "read app request") {
          throw new Error(`unexpected database operation: ${operation}`);
        }
        const [id] = Schema.decodeUnknownSync(RequestParameters)(parameters);
        const request = requests.get(id);
        const decode = Schema.decodeUnknownSync(schema);
        return request === undefined ? [] : [decode(request)];
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
  it.effect("applies a new mutation once, then replays its recorded response", () =>
    Effect.gen(function* () {
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
        (sql) => sql.execute("apply mutation", "SELECT true").pipe(Effect.as({ accepted: true })),
      );

      expectTypeOf<Effect.Error<typeof mutation>>().toEqualTypeOf<Conflict | Internal>();
      expectTypeOf<Effect.Error<typeof databaseMutation>>().toEqualTypeOf<Conflict | Internal>();
      expect(yield* mutation).toEqual({ accepted: true });
      expect(yield* mutation).toEqual({ accepted: true });
      expect(applications).toBe(1);
    }),
  );

  it.effect("returns the recorded response for the same request", () =>
    Effect.gen(function* () {
      const result = yield* replayRequest({
        previous: stored,
        requestId,
        operation: stored.operation,
        payloadHash,
        response,
      });

      expect(result).toEqual({ accepted: true });
    }),
  );

  it.effect("rejects a request ID reused for different content", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        replayRequest({
          previous: stored,
          requestId,
          operation: stored.operation,
          payloadHash: Schema.decodeUnknownSync(Sha256)("b".repeat(64)),
          response,
        }),
      );

      expect(error).toBeInstanceOf(Conflict);
      if (!(error instanceof Conflict)) throw error;
      expect(error.reason).toBe("RequestIdCollision");
    }),
  );

  it.effect("fails loudly when a recorded response no longer matches its schema", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        replayRequest({
          previous: { ...stored, response: { accepted: "yes" } },
          requestId,
          operation: stored.operation,
          payloadHash,
          response,
        }),
      );

      expect(error).toBeInstanceOf(Internal);
    }),
  );
});

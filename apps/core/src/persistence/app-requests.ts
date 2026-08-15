import { Conflict, Internal } from "@ironcage/contracts/schema";
import { RequestId, Sha256 } from "@ironcage/domain";
import { Effect, Schema } from "effect";

import {
  decodeStored,
  PersistenceError,
  persistenceToBoundary,
  type WithoutPersistence,
} from "./error";
import { Postgres, type SqlExecutor } from "./postgres";

export const StoredRequest = Schema.Struct({
  requestId: RequestId,
  operation: Schema.String,
  payloadHash: Sha256,
  response: Schema.Json,
});
export type StoredRequest = typeof StoredRequest.Type;

interface AppRequestStore {
  readonly findForMutation: (
    requestId: RequestId,
  ) => Effect.Effect<StoredRequest | null, PersistenceError>;
  readonly record: (request: StoredRequest) => Effect.Effect<void, PersistenceError>;
}

const appRequestStore = (sql: SqlExecutor): AppRequestStore => ({
  findForMutation: (requestId) =>
    Effect.gen(function* () {
      yield* sql.execute(
        "lock app request",
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [requestId],
      );
      const rows = yield* sql.rows(
        "read app request",
        StoredRequest,
        `SELECT request_id AS "requestId", operation, payload_hash AS "payloadHash", response
           FROM app_requests
          WHERE request_id = $1`,
        [requestId],
      );
      return rows[0] ?? null;
    }),
  record: (request) =>
    Effect.gen(function* () {
      yield* sql.execute(
        "record app request",
        `INSERT INTO app_requests (request_id, operation, payload_hash, response, completed_at)
         VALUES ($1, $2, $3, $4::jsonb, now())`,
        [
          request.requestId,
          request.operation,
          request.payloadHash,
          JSON.stringify(request.response),
        ],
      );
    }).pipe(Effect.asVoid),
});

export const replayRequest = <A>(input: {
  readonly previous: StoredRequest;
  readonly requestId: RequestId;
  readonly operation: string;
  readonly payloadHash: Sha256;
  readonly response: Schema.Decoder<A, never>;
}): Effect.Effect<A, Conflict | Internal> => {
  if (
    input.previous.operation !== input.operation ||
    input.previous.payloadHash !== input.payloadHash
  ) {
    return Effect.fail(
      new Conflict({
        reason: "RequestIdCollision",
        detail: `${input.requestId} was already used with different content`,
      }),
    );
  }

  return decodeStored(input.response, input.previous.response, input.operation);
};

const encodeResponse = <A, I>(
  schema: Schema.Codec<A, I, never, never>,
  value: A,
  operation: string,
): Effect.Effect<Schema.Json, Internal> =>
  Schema.encodeEffect(schema)(value).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Json)),
    Effect.mapError(
      () => new Internal({ detail: `response for ${operation} failed schema encoding` }),
    ),
  );

export type AppMutationError<E> = WithoutPersistence<E> | Conflict | Internal;

export const runIdempotentMutation = <A, I, E, R>(
  input: {
    readonly requestId: RequestId;
    readonly operation: string;
    readonly payloadHash: Sha256;
    readonly response: Schema.Codec<A, I, never, never>;
  },
  mutate: (sql: SqlExecutor) => Effect.Effect<A, E, R>,
): Effect.Effect<A, AppMutationError<E>, R | Postgres> =>
  Effect.gen(function* () {
    const postgres = yield* Postgres;

    return yield* postgres.transaction((sql) =>
      Effect.gen(function* () {
        const requests = appRequestStore(sql);
        const previous = yield* requests.findForMutation(input.requestId);

        if (previous !== null) return yield* replayRequest({ ...input, previous });

        const response = yield* mutate(sql);
        const encoded = yield* encodeResponse(input.response, response, input.operation);
        yield* requests.record({ ...input, response: encoded });
        return response;
      }),
    );
  }).pipe(persistenceToBoundary);

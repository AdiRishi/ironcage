import { Context, Effect, Layer, Schema } from "effect";
import type { Client, QueryResultRow } from "pg";

import { PersistenceError } from "./error";

export interface SqlExecutor {
  readonly execute: (
    operation: string,
    statement: string,
    parameters?: readonly unknown[],
  ) => Effect.Effect<void, PersistenceError>;
  readonly rows: <A>(
    operation: string,
    schema: Schema.Decoder<A, never>,
    statement: string,
    parameters?: readonly unknown[],
  ) => Effect.Effect<readonly A[], PersistenceError>;
}

export interface PostgresService extends SqlExecutor {
  readonly transaction: <A, E, R>(
    use: (sql: SqlExecutor) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | PersistenceError, R>;
  readonly readTransaction: <A, E, R>(
    use: (sql: SqlExecutor) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | PersistenceError, R>;
}

const query = (
  client: Client,
  operation: string,
  statement: string,
  parameters: readonly unknown[],
) =>
  Effect.tryPromise({
    try: () => client.query<QueryResultRow>(statement, [...parameters]),
    catch: (cause) => new PersistenceError({ operation, cause }),
  });

const executor = (client: Client): SqlExecutor => ({
  execute: (operation, statement, parameters = []) =>
    query(client, operation, statement, parameters).pipe(Effect.asVoid),
  rows: (operation, schema, statement, parameters = []) =>
    query(client, operation, statement, parameters).pipe(
      Effect.flatMap((result) =>
        Effect.forEach(result.rows, (row) =>
          Schema.decodeUnknownEffect(schema)(row).pipe(
            Effect.mapError((cause) => new PersistenceError({ operation, cause })),
          ),
        ),
      ),
    ),
});

const transactional = <A, E, R>(
  sql: SqlExecutor,
  begin: string,
  use: (sql: SqlExecutor) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E | PersistenceError, R> =>
  Effect.gen(function* () {
    yield* sql.execute("begin transaction", begin);

    return yield* use(sql).pipe(
      Effect.matchCauseEffect({
        onFailure: (cause) =>
          sql.execute("rollback transaction", "ROLLBACK").pipe(
            Effect.catchCause(() => Effect.void),
            Effect.andThen(Effect.failCause(cause)),
          ),
        onSuccess: (value) => sql.execute("commit transaction", "COMMIT").pipe(Effect.as(value)),
      }),
    );
  });

const serviceFor = (client: Client): PostgresService => {
  const sql = executor(client);

  return {
    ...sql,
    transaction: (use) => transactional(sql, "BEGIN", use),
    readTransaction: (use) =>
      transactional(sql, "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY", use),
  };
};

export class Postgres extends Context.Service<Postgres, PostgresService>()(
  "ironcage/core/persistence/Postgres",
) {
  static readonly layerForRequest = (
    connectionString: string,
  ): Layer.Layer<Postgres, PersistenceError> =>
    Layer.effect(
      Postgres,
      Effect.gen(function* () {
        const client = yield* Effect.acquireRelease(
          Effect.tryPromise({
            try: async () => {
              const { Client, types } = await import("pg");
              // `date` crosses as its ISO text form. The driver's default —
              // a JS Date at local midnight — would shift bank posting dates
              // across time zones.
              types.setTypeParser(types.builtins.DATE, (value) => value);
              const opened = new Client({
                connectionString,
                application_name: "ironcage-core",
              });
              await opened.connect();
              return opened;
            },
            catch: (cause) => new PersistenceError({ operation: "connect to Postgres", cause }),
          }),
          (opened) => Effect.promise(() => opened.end()),
        );

        return serviceFor(client);
      }),
    );
}

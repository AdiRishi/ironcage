import { Effect, Schema } from "effect";
import type { Client, ClientConfig, QueryResultRow } from "pg";

import { PersistenceError } from "../persistence";

export const moneyRecordLock = "ironcage:money-record";

export interface SqlExecutor {
  readonly query: (
    operation: string,
    text: string,
    values?: readonly unknown[],
  ) => Effect.Effect<readonly Readonly<Record<string, unknown>>[], PersistenceError>;
}

const clientConfigFor = (connectionString: string): ClientConfig => {
  const url = new URL(connectionString);
  if (url.searchParams.get("sslrootcert") !== "system") return { connectionString };

  const sslMode = url.searchParams.get("sslmode");
  const permissive = ["require", "prefer", "allow"].includes(sslMode ?? "");

  // node-postgres treats libpq's `sslrootcert=system` as a literal file path.
  url.searchParams.delete("sslrootcert");
  url.searchParams.delete("sslmode");

  return {
    connectionString: url.toString(),
    ssl: sslMode === "disable" ? false : { rejectUnauthorized: !permissive },
  };
};

const executor = (client: Client): SqlExecutor => ({
  query: (operation, text, values = []) =>
    Effect.tryPromise({
      try: () => client.query<QueryResultRow>(text, [...values]),
      catch: (cause) => new PersistenceError({ operation, cause }),
    }).pipe(
      // The boundary reports the operation and nothing else, because a database
      // message is not for the operator. It is exactly what an engineer needs,
      // so it is logged here rather than discarded.
      Effect.tapError((error) => Effect.logError(`${operation} failed`, error.cause)),
      Effect.map((result) =>
        result.rows.map((row) => {
          const record: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(row)) record[key] = value;
          return record;
        }),
      ),
    ),
});

export const withClient = <A, E, R>(
  connectionString: string,
  use: (sql: SqlExecutor) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E | PersistenceError, R> =>
  Effect.scoped(
    Effect.gen(function* () {
      const client = yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: async () => {
            const { Client } = await import("pg");
            const opened = new Client({
              ...clientConfigFor(connectionString),
              application_name: "ironcage-core",
            });
            await opened.connect();
            return opened;
          },
          catch: (cause) => new PersistenceError({ operation: "connect", cause }),
        }),
        (opened) => Effect.promise(() => opened.end()),
      );

      return yield* use(executor(client));
    }),
  );

const transactional = <A, E, R>(
  connectionString: string,
  begin: string,
  lockKey: string | null,
  use: (sql: SqlExecutor) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E | PersistenceError, R> =>
  withClient(connectionString, (sql) =>
    Effect.gen(function* () {
      yield* sql.query("begin transaction", begin);
      if (lockKey !== null) {
        yield* sql.query(
          "lock financial record",
          "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
          [lockKey],
        );
      }

      return yield* use(sql).pipe(
        Effect.matchCauseEffect({
          onFailure: (cause) =>
            sql.query("rollback transaction", "ROLLBACK").pipe(
              Effect.catchCause(() => Effect.void),
              Effect.andThen(Effect.failCause(cause)),
            ),
          onSuccess: (value) => sql.query("commit transaction", "COMMIT").pipe(Effect.as(value)),
        }),
      );
    }),
  );

export const inTransaction = <A, E, R>(
  connectionString: string,
  lockKey: string | null,
  use: (sql: SqlExecutor) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E | PersistenceError, R> =>
  transactional(connectionString, "BEGIN", lockKey, use);

export const inReadTransaction = <A, E, R>(
  connectionString: string,
  use: (sql: SqlExecutor) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E | PersistenceError, R> =>
  transactional(
    connectionString,
    "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    null,
    use,
  );

export const decodeRows = <A>(
  operation: string,
  schema: Schema.Decoder<A, never>,
  rows: readonly Readonly<Record<string, unknown>>[],
) =>
  Effect.forEach(rows, (row) =>
    Schema.decodeUnknownEffect(schema)(row).pipe(
      Effect.mapError((cause) => new PersistenceError({ operation, cause })),
    ),
  );

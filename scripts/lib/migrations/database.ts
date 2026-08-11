import { Context, Effect, Layer, Schema } from "effect";
import pg from "pg";

export class DatabaseError extends Schema.TaggedError<DatabaseError>()("DatabaseError", {
  statement: Schema.String,
  detail: Schema.String,
}) {}

// `sslrootcert=system` tells libpq to trust the operating system's store.
// node-postgres reads it as a filename and fails on a file called `system`, so
// the TLS settings move out of the URL and into the client configuration.
const configFor = (connectionString: string): pg.ClientConfig => {
  const url = new URL(connectionString);
  if (url.searchParams.get("sslrootcert") !== "system") return { connectionString };

  const sslMode = url.searchParams.get("sslmode");
  const permissive = ["require", "prefer", "allow"].includes(sslMode ?? "");

  url.searchParams.delete("sslrootcert");
  url.searchParams.delete("sslmode");

  return {
    connectionString: url.toString(),
    ssl: sslMode === "disable" ? false : { rejectUnauthorized: !permissive },
  };
};

/**
 * One Postgres session, injectable so the applier can be exercised without a
 * database. The migrator holds a session rather than a pool because its
 * advisory lock is session-scoped: a pooled connection could hand the next
 * statement to a different backend and quietly drop the mutual exclusion.
 */
export class Database extends Context.Service<
  Database,
  {
    readonly query: <A>(
      statement: string,
      parameters?: ReadonlyArray<unknown>,
    ) => Effect.Effect<ReadonlyArray<A>, DatabaseError>;
  }
>()("ironcage/scripts/migrations/Database") {
  static readonly layer = (connectionString: string): Layer.Layer<Database, DatabaseError> =>
    Layer.effect(
      Database,
      Effect.gen(function* () {
        const client = new pg.Client(configFor(connectionString));

        yield* Effect.tryPromise({
          try: () => client.connect(),
          catch: (cause) => new DatabaseError({ statement: "connect", detail: String(cause) }),
        });

        yield* Effect.addFinalizer(() => Effect.promise(() => client.end()));

        return Database.of({
          query: <A>(statement: string, parameters: ReadonlyArray<unknown> = []) =>
            Effect.tryPromise({
              try: () => client.query(statement, [...parameters]),
              catch: (cause) => new DatabaseError({ statement, detail: String(cause) }),
            }).pipe(Effect.map((result) => result.rows as ReadonlyArray<A>)),
        });
      }),
    );
}

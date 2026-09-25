import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { applyMigrations, makePgMigrationExecutor } from "alchemy/SQL/Migrations/index";
import { Config, Effect, Redacted, Schedule } from "effect";
import { Client } from "pg";

const migrate = Effect.gen(function* () {
  const url = yield* Config.Redacted("DATABASE_URL");
  const client = yield* Effect.acquireRelease(
    Effect.tryPromise(async () => {
      const connection = new Client({ connectionString: Redacted.value(url) });
      await connection.connect();
      return connection;
    }).pipe(
      // A new container initialises its data directory before Postgres accepts TCP
      // connections, and with other test stages starting beside it that can take well
      // over ten seconds.
      Effect.retry({
        schedule: Schedule.spaced("500 millis").pipe(Schedule.upTo({ duration: "1 minute" })),
      }),
    ),
    (connection) => Effect.promise(() => connection.end()),
  );
  yield* applyMigrations({
    resolved: { dir: "../workers/api/migrations", table: "__alchemy_migrations" },
    executor: makePgMigrationExecutor(client),
  });
});
NodeRuntime.runMain(migrate.pipe(Effect.scoped, Effect.provide(NodeServices.layer)));

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
    }).pipe(Effect.retry({ times: 20, schedule: Schedule.spaced("500 millis") })),
    (connection) => Effect.promise(() => connection.end()),
  );
  yield* applyMigrations({
    resolved: { dir: "../workers/api/migrations", table: "__alchemy_migrations" },
    executor: makePgMigrationExecutor(client),
  });
});
NodeRuntime.runMain(migrate.pipe(Effect.scoped, Effect.provide(NodeServices.layer)));

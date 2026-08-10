import { Effect, Schema } from "effect";

import { Database, DatabaseError } from "./database.ts";
import type { LedgerRow, MigrationFile } from "./plan.ts";

/**
 * Bumped when the runner's semantics change, so a ledger row says which rules
 * were in force when it was written.
 */
export const runnerVersion = "1";

const lockKey = 8_070_140_121_919_871n;

export class VerificationFailed extends Schema.TaggedError<VerificationFailed>()(
  "VerificationFailed",
  { id: Schema.Int, name: Schema.String, verification: Schema.String },
) {}

export const ensureLedger = Effect.gen(function* () {
  const database = yield* Database;

  yield* database.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id             integer PRIMARY KEY,
      name           text NOT NULL,
      checksum       text NOT NULL,
      runner_version text NOT NULL,
      started_at     timestamptz NOT NULL,
      finished_at    timestamptz,
      outcome        text NOT NULL,
      verification   text NOT NULL
    )
  `);
});

export const readLedger = Effect.gen(function* () {
  const database = yield* Database;

  return yield* database.query<LedgerRow>(
    "SELECT id, name, checksum, outcome FROM schema_migrations ORDER BY id",
  );
});

/**
 * Held for the whole run on this one session. Hyperdrive pools in transaction
 * mode and would not keep it, which is why the runner needs a direct
 * connection.
 */
export const withLock = <A, E, R>(body: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const database = yield* Database;

    yield* database.query("SELECT pg_advisory_lock($1)", [lockKey.toString()]);

    return yield* Effect.ensuring(
      body,
      Effect.orDie(database.query("SELECT pg_advisory_unlock($1)", [lockKey.toString()])),
    );
  });

const markStarted = (migration: MigrationFile) =>
  Effect.flatMap(Database, (database) =>
    database.query(
      `INSERT INTO schema_migrations
         (id, name, checksum, runner_version, started_at, outcome, verification)
       VALUES ($1, $2, $3, $4, now(), 'running', $5)`,
      [migration.id, migration.name, migration.checksum, runnerVersion, migration.verification],
    ),
  );

const markOutcome = (migration: MigrationFile, outcome: "applied" | "failed") =>
  Effect.flatMap(Database, (database) =>
    database.query("UPDATE schema_migrations SET outcome = $1, finished_at = now() WHERE id = $2", [
      outcome,
      migration.id,
    ]),
  );

const verify = (migration: MigrationFile) =>
  Effect.gen(function* () {
    const database = yield* Database;
    const rows = yield* database.query<Record<string, unknown>>(migration.verification);
    const first = rows[0];
    const values = first ? Object.values(first) : [];

    if (rows.length !== 1 || values.length !== 1 || values[0] !== true) {
      return yield* new VerificationFailed({
        id: migration.id,
        name: migration.name,
        verification: migration.verification,
      });
    }
  });

/**
 * The ledger row is written outside the migration's transaction so a failure
 * survives the rollback that produced it; a run that dies mid-migration leaves
 * `running` behind, which the planner refuses to step over.
 */
export const applyMigration = (migration: MigrationFile) =>
  Effect.gen(function* () {
    const database = yield* Database;

    yield* markStarted(migration);

    const applied = Effect.gen(function* () {
      yield* database.query("BEGIN");
      yield* database.query(migration.statements);
      yield* database.query("COMMIT");
      yield* verify(migration);
    }).pipe(
      Effect.tapError(() =>
        Effect.andThen(
          Effect.orDie(database.query("ROLLBACK")),
          Effect.orDie(markOutcome(migration, "failed")),
        ),
      ),
    );

    yield* applied;
    yield* markOutcome(migration, "applied");
  });

export type ApplyError = DatabaseError | VerificationFailed;

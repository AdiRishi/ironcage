import { existsSync, readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";

import { Effect, Layer } from "effect";

import { applyMigration, ensureLedger, readLedger, withLock } from "./lib/migrations/apply.ts";
import { migrationMode } from "./lib/migrations/arguments.ts";
import { Database } from "./lib/migrations/database.ts";
import type { MigrationFile, Refusal } from "./lib/migrations/plan.ts";
import { parseMigration, plan } from "./lib/migrations/plan.ts";

const directory = join(import.meta.dirname, "..", "migrations");
const envFile = join(import.meta.dirname, "..", ".env");

const readMigrations = Effect.gen(function* () {
  // No directory reads as no migrations rather than as an error: a checkout
  // that has not written one yet is a valid state, and a ledger with rows in it
  // is refused by `Vanished` a few lines below.
  const entries = existsSync(directory)
    ? yield* Effect.promise(() => readdir(directory))
    : ([] as ReadonlyArray<string>);
  const files: Array<MigrationFile> = [];
  const refusals: Array<Refusal> = [];

  for (const entry of entries.filter((name) => name.endsWith(".sql")).sort()) {
    const parsed = parseMigration(entry, readFileSync(join(directory, entry), "utf8"));

    if ("_tag" in parsed) {
      refusals.push(parsed);
    } else {
      files.push(parsed);
    }
  }

  return { files, refusals };
});

const describe = (refusal: Refusal): string => {
  switch (refusal._tag) {
    case "Malformed":
      return `${refusal.file}: ${refusal.detail}`;
    case "Duplicate":
      return `two migrations numbered ${refusal.id}`;
    case "Drifted":
      return `${refusal.id}_${refusal.name} changed after it was applied`;
    case "Vanished":
      return `${refusal.id}_${refusal.name} was applied but its file is gone`;
    case "Unfinished":
      return `migration ${refusal.id} was left ${refusal.outcome} by an earlier run`;
    case "OutOfOrder":
      return `migration ${refusal.id} numbers below ${refusal.highestApplied}, already applied`;
  }
};

const migrate = (planOnly: boolean) =>
  Effect.gen(function* () {
    const found = yield* readMigrations;

    if (!planOnly) {
      yield* ensureLedger;
    }

    const ledger = yield* readLedger;
    const decided = plan(found.files, ledger);
    const refusals = [...found.refusals, ...decided.refusals];

    if (refusals.length > 0) {
      for (const refusal of refusals) {
        yield* Effect.logError(describe(refusal));
      }

      return yield* Effect.fail(new Error(`refused: ${refusals.length} problem(s)`));
    }

    if (decided.pending.length === 0) {
      yield* Effect.log(`nothing pending; ${ledger.length} migration(s) applied`);
      return;
    }

    for (const migration of decided.pending) {
      yield* Effect.log(
        `${planOnly ? "would apply" : "applying"} ${migration.id}_${migration.name}`,
      );
    }

    if (planOnly) {
      return;
    }

    for (const migration of decided.pending) {
      yield* applyMigration(migration);
      yield* Effect.log(`applied ${migration.id}_${migration.name}`);
    }
  });

if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const connectionString = process.env["DATABASE_URL"];

if (!connectionString) {
  console.error("DATABASE_URL must be a direct connection to the branch being migrated.");
  process.exit(1);
}

// Hyperdrive pools in transaction mode, so the session advisory lock the runner
// depends on would not survive it.
if (connectionString.includes("hyperdrive")) {
  console.error("DATABASE_URL must not point at Hyperdrive; migrations need a direct connection.");
  process.exit(1);
}

let mode: ReturnType<typeof migrationMode>;

try {
  mode = migrationMode(process.argv.slice(2));
} catch (error) {
  console.error(String(error));
  process.exit(1);
}

await Effect.runPromise(
  withLock(migrate(mode === "plan")).pipe(
    Effect.provide(Layer.orDie(Database.layer(connectionString))),
    Effect.scoped,
  ),
).catch((error: unknown) => {
  console.error(String(error));
  process.exit(1);
});

import { writeFileSync } from "node:fs";

import { Effect, Schema } from "effect";

import { applicationTest } from "../support/application.ts";
import {
  PopulatedFixture,
  dumpTables,
  migrationFiles,
  populate,
  populatedFixture,
} from "../support/populated.ts";

// Regenerates tests/fixtures/populated.json at the newest migration. Run it with
// `pnpm --filter @repo/api fixture:populated` before adding a migration, so the new
// migration is tested against data written by the code before it.
const { test, services } = applicationTest();
test(
  "writes the populated database fixture",
  Effect.gen(function* () {
    yield* populate;
    const migration = migrationFiles().at(-1);
    if (!migration) return yield* Effect.die("Expected migrations");
    const fixture = yield* Schema.encodeEffect(PopulatedFixture)({
      migration,
      tables: yield* dumpTables,
    });
    writeFileSync(populatedFixture, `${JSON.stringify(fixture, null, 1)}\n`);
  }).pipe(Effect.provide(services)),
  120_000,
);

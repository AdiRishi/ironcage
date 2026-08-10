import { Effect, Layer } from "effect";
import { describe, expect, test } from "vitest";

import { applyMigration, VerificationFailed } from "../../../lib/migrations/apply.ts";
import { Database } from "../../../lib/migrations/database.ts";
import type { MigrationFile } from "../../../lib/migrations/plan.ts";

const migration: MigrationFile = {
  id: 1,
  name: "create_sleeves",
  statements: "CREATE TABLE sleeves ();",
  verification: "SELECT true",
  checksum: "abc",
};

/** Records what the applier asks of a database, and answers the verification. */
const recording = (verificationAnswer: unknown) => {
  const statements: Array<string> = [];
  const layer = Layer.succeed(Database)(
    Database.of({
      query: <A>(statement: string) => {
        statements.push(statement.trim().split("\n")[0]!.trim());
        const rows = statement === "SELECT true" ? [{ ok: verificationAnswer }] : [];

        return Effect.succeed(rows as ReadonlyArray<unknown> as ReadonlyArray<A>);
      },
    }),
  );

  return { statements, layer };
};

describe("applyMigration", () => {
  test("commits the migration, then verifies it", async () => {
    const { statements, layer } = recording(true);

    await Effect.runPromise(applyMigration(migration).pipe(Effect.provide(layer)));

    expect(statements).toStrictEqual([
      "INSERT INTO schema_migrations",
      "BEGIN",
      "CREATE TABLE sleeves ();",
      "COMMIT",
      "SELECT true",
      "UPDATE schema_migrations SET outcome = $1, finished_at = now() WHERE id = $2",
    ]);
  });

  // A migration whose verification does not hold has not done what it claimed,
  // and the ledger has to say so rather than reading as applied.
  test("records a failure when the verification does not hold", async () => {
    const { statements, layer } = recording(false);

    const error = await Effect.runPromise(
      Effect.flip(applyMigration(migration).pipe(Effect.provide(layer))),
    );

    expect(error).toBeInstanceOf(VerificationFailed);
    expect(statements).toContain("ROLLBACK");
    expect(statements.at(-1)).toBe(
      "UPDATE schema_migrations SET outcome = $1, finished_at = now() WHERE id = $2",
    );
  });
});

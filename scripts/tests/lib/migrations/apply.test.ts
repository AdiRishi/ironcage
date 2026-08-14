import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

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

/** Simulates the transaction boundary while answering the verification query. */
const recording = (verificationAnswer: unknown) => {
  const statements: Array<string> = [];
  let committedSchema = false;
  let transactionSchema: boolean | undefined;
  let ledgerOutcome: "running" | "applied" | "failed" | undefined;
  const layer = Layer.succeed(Database)(
    Database.of({
      query: <A>(statement: string, parameters: ReadonlyArray<unknown> = []) => {
        statements.push(statement.trim().split("\n")[0]!.trim());

        if (statement.startsWith("INSERT INTO schema_migrations")) {
          ledgerOutcome = "running";
        } else if (statement === "BEGIN") {
          transactionSchema = committedSchema;
        } else if (statement === migration.statements) {
          transactionSchema = true;
        } else if (statement === "COMMIT") {
          committedSchema = transactionSchema ?? committedSchema;
          transactionSchema = undefined;
        } else if (statement === "ROLLBACK") {
          transactionSchema = undefined;
        } else if (statement.startsWith("UPDATE schema_migrations")) {
          const outcome = parameters[0];

          if (outcome === "applied" || outcome === "failed") {
            ledgerOutcome = outcome;
          }
        }

        const rows = statement === "SELECT true" ? [{ ok: verificationAnswer }] : [];

        return Effect.succeed(rows as ReadonlyArray<unknown> as ReadonlyArray<A>);
      },
    }),
  );

  return {
    statements,
    layer,
    state: () => ({
      committedSchema,
      ledgerOutcome,
      transactionOpen: transactionSchema !== undefined,
    }),
  };
};

describe("applyMigration", () => {
  it.effect("commits a migration only after its verification holds", () =>
    Effect.gen(function* () {
      const { statements, layer, state } = recording(true);

      yield* applyMigration(migration).pipe(Effect.provide(layer));

      expect(statements).toStrictEqual([
        "INSERT INTO schema_migrations",
        "BEGIN",
        "CREATE TABLE sleeves ();",
        "SELECT true",
        "COMMIT",
        "UPDATE schema_migrations SET outcome = $1, finished_at = now() WHERE id = $2",
      ]);
      expect(state()).toStrictEqual({
        committedSchema: true,
        ledgerOutcome: "applied",
        transactionOpen: false,
      });
    }),
  );

  // A migration whose verification does not hold has not done what it claimed,
  // and the ledger has to say so rather than reading as applied.
  it.effect("records a failure when the verification does not hold", () =>
    Effect.gen(function* () {
      const { layer, state } = recording(false);

      const error = yield* Effect.flip(applyMigration(migration).pipe(Effect.provide(layer)));

      expect(error).toBeInstanceOf(VerificationFailed);
      expect(state()).toStrictEqual({
        committedSchema: false,
        ledgerOutcome: "failed",
        transactionOpen: false,
      });
    }),
  );
});

import { describe, expect, test } from "vitest";

import type { LedgerRow, MigrationFile } from "../../../lib/migrations/plan.ts";
import { checksumOf, parseMigration, plan } from "../../../lib/migrations/plan.ts";

const file = (id: number, name: string, statements = "CREATE TABLE x ();"): MigrationFile => ({
  id,
  name,
  statements,
  verification: "SELECT true",
  checksum: checksumOf(statements),
});

const applied = (migration: MigrationFile): LedgerRow => ({
  id: migration.id,
  name: migration.name,
  checksum: migration.checksum,
  outcome: "applied",
});

describe("parseMigration", () => {
  test("reads the number, name, and declared verification", () => {
    const parsed = parseMigration(
      "0007_create_sleeves.sql",
      "-- verify: SELECT true\nCREATE TABLE sleeves ();",
    );

    expect(parsed).toMatchObject({ id: 7, name: "create_sleeves", verification: "SELECT true" });
  });

  // Without one, nothing establishes that the migration did what it claimed.
  test("rejects a file that declares no verification", () => {
    const parsed = parseMigration("0001_x.sql", "CREATE TABLE x ();");

    expect(parsed).toMatchObject({ _tag: "Malformed" });
  });

  test("rejects a file whose name does not carry a number", () => {
    const parsed = parseMigration("create_sleeves.sql", "-- verify: SELECT true");

    expect(parsed).toMatchObject({ _tag: "Malformed" });
  });
});

describe("plan", () => {
  test("runs unapplied migrations in numeric order", () => {
    const decided = plan([file(2, "b"), file(1, "a"), file(10, "j")], []);

    expect(decided.pending.map((migration) => migration.id)).toStrictEqual([1, 2, 10]);
    expect(decided.refusals).toStrictEqual([]);
  });

  test("skips what the ledger already records", () => {
    const first = file(1, "a");
    const decided = plan([first, file(2, "b")], [applied(first)]);

    expect(decided.pending.map((migration) => migration.id)).toStrictEqual([2]);
  });

  // An applied migration is history. Editing one means environments that ran it
  // before and after no longer share a schema.
  test("refuses when an applied migration's file has changed", () => {
    const first = file(1, "a");
    const decided = plan([{ ...first, checksum: checksumOf("something else") }], [applied(first)]);

    expect(decided.refusals).toStrictEqual([{ _tag: "Drifted", id: 1, name: "a" }]);
    expect(decided.pending).toStrictEqual([]);
  });

  test("refuses when an applied migration's file is gone", () => {
    const decided = plan([], [applied(file(1, "a"))]);

    expect(decided.refusals).toStrictEqual([{ _tag: "Vanished", id: 1, name: "a" }]);
  });

  test("refuses when an earlier run left a migration unfinished", () => {
    const first = file(1, "a");
    const decided = plan([first], [{ ...applied(first), outcome: "running" }]);

    expect(decided.refusals).toStrictEqual([{ _tag: "Unfinished", id: 1, outcome: "running" }]);
  });

  // Two branches that each took the next free number would otherwise apply in
  // whichever order they merged.
  test("refuses a pending migration numbered below one already applied", () => {
    const third = file(3, "c");
    const decided = plan([file(2, "b"), third], [applied(third)]);

    expect(decided.refusals).toStrictEqual([{ _tag: "OutOfOrder", id: 2, highestApplied: 3 }]);
    expect(decided.pending).toStrictEqual([]);
  });

  test("refuses two migrations sharing a number", () => {
    const decided = plan([file(1, "a"), file(1, "b")], []);

    expect(decided.refusals).toStrictEqual([{ _tag: "Duplicate", id: 1 }]);
  });
});

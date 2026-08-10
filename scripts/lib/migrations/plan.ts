import { createHash } from "node:crypto";

export interface MigrationFile {
  readonly id: number;
  readonly name: string;
  readonly statements: string;
  readonly verification: string;
  readonly checksum: string;
}

export interface LedgerRow {
  readonly id: number;
  readonly name: string;
  readonly checksum: string;
  readonly outcome: "applied" | "failed" | "running";
}

/** Every reason the runner stops rather than guessing. */
export type Refusal =
  | { readonly _tag: "Malformed"; readonly file: string; readonly detail: string }
  | { readonly _tag: "Duplicate"; readonly id: number }
  | { readonly _tag: "Drifted"; readonly id: number; readonly name: string }
  | { readonly _tag: "Vanished"; readonly id: number; readonly name: string }
  | { readonly _tag: "Unfinished"; readonly id: number; readonly outcome: string }
  | { readonly _tag: "OutOfOrder"; readonly id: number; readonly highestApplied: number };

export interface Plan {
  readonly pending: ReadonlyArray<MigrationFile>;
  readonly refusals: ReadonlyArray<Refusal>;
}

const fileName = /^(\d{4})_([a-z0-9_]+)\.sql$/;
const verification = /^--\s*verify:\s*(.+)$/gm;

export const checksumOf = (contents: string): string =>
  createHash("sha256").update(contents, "utf8").digest("hex");

export const parseMigration = (file: string, contents: string): MigrationFile | Refusal => {
  const named = fileName.exec(file);

  if (!named?.[1] || !named[2]) {
    return { _tag: "Malformed", file, detail: "expected NNNN_lower_snake_name.sql" };
  }

  const declared = [...contents.matchAll(verification)].map((match) => match[1]?.trim() ?? "");

  if (declared.length !== 1 || !declared[0]) {
    return {
      _tag: "Malformed",
      file,
      detail: `expected exactly one "-- verify:" line, found ${declared.length}`,
    };
  }

  return {
    id: Number(named[1]),
    name: named[2],
    statements: contents,
    verification: declared[0],
    checksum: checksumOf(contents),
  };
};

/**
 * What to run, and every reason not to. Kept separate from applying so the
 * rules that protect an immutable history can be exercised without a database.
 */
export const plan = (
  files: ReadonlyArray<MigrationFile>,
  ledger: ReadonlyArray<LedgerRow>,
): Plan => {
  const refusals: Array<Refusal> = [];
  const byId = new Map<number, MigrationFile>();

  for (const file of [...files].sort((left, right) => left.id - right.id)) {
    if (byId.has(file.id)) {
      refusals.push({ _tag: "Duplicate", id: file.id });
      continue;
    }
    byId.set(file.id, file);
  }

  let highestApplied = 0;

  for (const row of ledger) {
    if (row.outcome !== "applied") {
      refusals.push({ _tag: "Unfinished", id: row.id, outcome: row.outcome });
      continue;
    }

    highestApplied = Math.max(highestApplied, row.id);

    const file = byId.get(row.id);

    if (!file) {
      refusals.push({ _tag: "Vanished", id: row.id, name: row.name });
    } else if (file.checksum !== row.checksum) {
      refusals.push({ _tag: "Drifted", id: row.id, name: row.name });
    }
  }

  const recorded = new Set(ledger.map((row) => row.id));
  const pending: Array<MigrationFile> = [];

  for (const file of byId.values()) {
    if (recorded.has(file.id)) {
      continue;
    }

    // Two branches that each took the next free number would otherwise apply in
    // whichever order they merged, so history would differ per environment.
    if (file.id < highestApplied) {
      refusals.push({ _tag: "OutOfOrder", id: file.id, highestApplied });
      continue;
    }

    pending.push(file);
  }

  return { pending, refusals };
};

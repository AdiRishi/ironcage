import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, it } from "@effect/vitest";
import type { BankAccountSummary, BankImportSource } from "@ironcage/contracts/schema";
import { RequestId, Sha256 } from "@ironcage/domain";
import { Effect, Schema } from "effect";

import { mintId } from "../../src/ids";
import { configureBankAccount, getBankCoverage } from "../../src/money/accounts/service";
import {
  confirmBankImport,
  previewBankImport,
  type ImportDeps,
} from "../../src/money/import/service";
import { Postgres } from "../../src/persistence/postgres";
import { usePostgresTestDatabase } from "../persistence/postgres-test-database";
import { makeDepositPair, type SyntheticRow } from "./synthetic-pair";

const database = usePostgresTestDatabase();
const sha = Schema.decodeUnknownSync(Sha256);
const statementMarkdown = readFile(
  resolve(import.meta.dirname, "../fixtures/money/commbank/statement/offset-statement-a.md"),
  "utf8",
);
const deps: ImportDeps = {
  identityKey: "statement-key",
  extractStatement: async () => ({
    markdown: await statementMarkdown,
    extractor: { package: "@firecrawl/anydoc", version: "0.1.9" },
  }),
};

const withDatabase = <A, E>(effect: Effect.Effect<A, E, Postgres>) =>
  effect.pipe(Effect.provide(Postgres.layerForRequest(database.connectionString())));

const configure = () =>
  withDatabase(
    configureBankAccount({
      requestId: Effect.runSync(mintId(RequestId)),
      payloadHash: sha("a".repeat(64)),
      productLabel: "Spending offset",
      accountType: "deposit",
      required: true,
      openedOn: null,
      closedOn: null,
    }),
  );

const confirmSource = (source: BankImportSource) =>
  Effect.gen(function* () {
    const preview = yield* withDatabase(previewBankImport(source, deps));
    if (preview.kind !== "ready") {
      throw new Error(`expected a ready preview: ${JSON.stringify(preview)}`);
    }
    const confirmed = yield* withDatabase(
      confirmBankImport(
        {
          source,
          expectedBundleDigest: preview.preview.bundleDigest,
          expectedPreviewFingerprint: preview.preview.previewFingerprint,
          resolutions: [],
          requestId: yield* mintId(RequestId),
        },
        deps,
      ),
    );
    if (confirmed.kind !== "confirmed") {
      throw new Error(`expected a confirmed import: ${JSON.stringify(confirmed)}`);
    }
    return { preview: preview.preview, confirmed };
  });

const structuredSource = (
  account: BankAccountSummary,
  rows: readonly SyntheticRow[],
): BankImportSource => {
  const pair = makeDepositPair("10000001", rows, ["25/03/2032", "31/03/2032"]);
  return {
    kind: "commbank_structured",
    accountId: account.id,
    csv: { displayName: "CSVData.csv", bytes: pair.csv },
    ofx: { displayName: "OFXData.ofx", bytes: pair.ofx },
  };
};

const statementSource = (account: BankAccountSummary): BankImportSource => ({
  kind: "commbank_statement",
  accountId: account.id,
  pdf: { displayName: "Statement.pdf", bytes: new TextEncoder().encode("%PDF-fixture") },
});

const marchRows: readonly SyntheticRow[] = [
  { date: "26/03/2032", amount: "-100.00", narrative: "ACME INSURANCE DD", balance: "9900.00" },
  { date: "27/03/2032", amount: "-45.20", narrative: "FRESH MART", balance: "9854.80" },
  { date: "28/03/2032", amount: "-15.50", narrative: "CLOUDY HOSTING", balance: "9839.30" },
];

const count = (table: string) =>
  withDatabase(
    Effect.gen(function* () {
      const postgres = yield* Postgres;
      const rows = yield* postgres.query(
        `count ${table}`,
        `SELECT count(*)::integer AS count FROM ${table}`,
      );
      return rows[0]!["count"] as number;
    }),
  );

it.effect("imports statement history while linking its structured overlap", () =>
  Effect.gen(function* () {
    const account = yield* configure();

    yield* confirmSource(structuredSource(account, marchRows));
    const { preview } = yield* confirmSource(statementSource(account));

    expect(preview.sourceProfile).toBe("cba-offset-statement-v1");
    expect(preview.effects).toEqual({ new: 8, duplicate: 3, ambiguous: 0 });
    expect(preview.window).toEqual({ start: "2032-03-25", end: "2032-06-24" });
    expect(yield* count("bank_transactions")).toBe(11);
    expect(yield* count("bank_source_files")).toBe(4);

    const coverage = yield* withDatabase(getBankCoverage());
    expect(coverage.accounts[0]!.covered).toEqual([{ start: "2032-03-25", end: "2032-06-24" }]);

    const replay = yield* withDatabase(previewBankImport(statementSource(account), deps));
    if (replay.kind !== "ready") throw new Error("expected a ready preview");
    expect(replay.preview.alreadyConfirmed).toBe(true);
    expect(yield* count("bank_imports")).toBe(2);
  }),
);

it.effect("blocks a statement that omits a transaction inside structured coverage", () =>
  Effect.gen(function* () {
    const account = yield* configure();

    yield* confirmSource(
      structuredSource(account, [
        ...marchRows,
        { date: "29/03/2032", amount: "-77.00", narrative: "NOT ON STATEMENT", balance: "9762.30" },
      ]),
    );

    const result = yield* withDatabase(previewBankImport(statementSource(account), deps));
    expect(result).toMatchObject({
      kind: "blocked",
      block: { code: "StatementOverlapMismatch" },
    });
    expect(yield* count("bank_imports")).toBe(1);
  }),
);

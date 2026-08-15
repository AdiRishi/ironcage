import { existsSync } from "node:fs";
import { appendFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, it } from "@effect/vitest";
import type { BankAccountSummary, BankImportSource } from "@ironcage/contracts/schema";
import { RequestId, Sha256, type BankAccountType } from "@ironcage/domain";
import { Effect, Schema } from "effect";

import { mintId } from "../../src/ids";
import { configureBankAccount, getBankCoverage } from "../../src/money/accounts";
import { getMoneyAnalysis } from "../../src/money/analysis";
import { listTransactions } from "../../src/money/categorization";
import { confirmBankImport, previewBankImport, type ImportDeps } from "../../src/money/import";
import { getTransferMatches } from "../../src/money/transfers";
import { Postgres } from "../../src/persistence/postgres";
import { usePostgresTestDatabase } from "../persistence/postgres-test-database";

const database = usePostgresTestDatabase();
const privateDir = resolve(import.meta.dirname, "../../../../.private-fixtures/commbank");
const sha = Schema.decodeUnknownSync(Sha256);

const reportPath = "/tmp/ironcage-validation.txt";
const log = (line: string) => Effect.promise(() => appendFile(reportPath, `${line}\n`));

const bytes = async (name: string) => new Uint8Array(await readFile(resolve(privateDir, name)));

const deps: ImportDeps = {
  identityKey: "real-validation-key",
  extractStatement: async () => ({
    markdown: new TextDecoder().decode(await bytes("statement-extracted.md")),
    extractor: { package: "@firecrawl/anydoc", version: "0.1.9" },
  }),
};

const withDatabase = <A, E>(effect: Effect.Effect<A, E, Postgres>) =>
  effect.pipe(Effect.provide(Postgres.layerForRequest(database.connectionString())));

const configure = (label: string, accountType: BankAccountType, seed: string) =>
  withDatabase(
    configureBankAccount({
      requestId: Effect.runSync(mintId(RequestId)),
      payloadHash: sha(seed.repeat(64).slice(0, 64)),
      productLabel: label,
      accountType,
      required: true,
      openedOn: null,
      closedOn: null,
    }),
  );

const doImport = (source: BankImportSource, label: string) =>
  Effect.gen(function* () {
    const preview = yield* withDatabase(previewBankImport(source, deps));
    if (preview.kind !== "ready") {
      yield* log(
        `${label}: BLOCKED ${JSON.stringify(preview.kind === "blocked" ? preview.block : {})}`,
      );
      throw new Error(`${label} blocked`);
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
    if (confirmed.kind !== "confirmed") throw new Error(`${label} confirm failed`);
    yield* log(
      `${label}: new=${confirmed.effects.new} dup=${confirmed.effects.duplicate} ` +
        `window=${preview.preview.window.start}..${preview.preview.window.end} already=${preview.preview.alreadyConfirmed}`,
    );
    return { preview: preview.preview, confirmed };
  });

const structured = (account: BankAccountSummary, csvName: string, ofxName: string) =>
  Effect.gen(function* () {
    const csv = yield* Effect.promise(() => bytes(csvName));
    const ofx = yield* Effect.promise(() => bytes(ofxName));
    return {
      kind: "commbank_structured",
      accountId: account.id,
      csv: { displayName: csvName, bytes: csv },
      ofx: { displayName: ofxName, bytes: ofx },
    } as const;
  });

// The private corpus never enters the repository; this harness certifies the
// whole pipeline against the operator's real exports wherever they are staged
// and writes its summary to /tmp/ironcage-validation.txt.
it.effect("the real corpus imports, dedupes, reconciles, and analyzes", () =>
  Effect.gen(function* () {
    if (!existsSync(privateDir)) return;
    yield* log(`=== run at ${new Date().toISOString()} ===`);
    const spending = yield* configure("Spending offset", "deposit", "a");
    const savings = yield* configure("Savings offset", "deposit", "b");
    const mastercard = yield* configure("Mastercard", "credit_card", "c");
    const homeLoan = yield* configure("Home loan", "credit_line", "d");

    yield* doImport(yield* structured(spending, "CSVData.csv", "OFXData.ofx"), "spending-a");
    yield* doImport(
      yield* structured(spending, "CSVData (1).csv", "OFXData (1).ofx"),
      "spending-b",
    );
    yield* doImport(
      yield* structured(spending, "CSVData (2).csv", "OFXData (2).ofx"),
      "spending-c",
    );
    yield* doImport(yield* structured(savings, "CSVData (4).csv", "OFXData (4).ofx"), "savings");
    yield* doImport(
      yield* structured(mastercard, "CSVData (3).csv", "OFXData (3).ofx"),
      "mastercard",
    );
    yield* doImport(yield* structured(homeLoan, "CSVData (5).csv", "OFXData (5).ofx"), "home-loan");

    // Exit criterion: reimport writes nothing new.
    const replay = yield* doImport(
      yield* structured(spending, "CSVData.csv", "OFXData.ofx"),
      "spending-a-replay",
    );
    expect(replay.preview.alreadyConfirmed).toBe(true);

    const statement = yield* doImport(
      {
        kind: "commbank_statement",
        accountId: spending.id,
        pdf: {
          displayName: "Statements20260624.pdf",
          bytes: yield* Effect.promise(() => bytes("Statements20260624.pdf")),
        },
      },
      "statement",
    );
    expect(statement.confirmed.effects.new + statement.confirmed.effects.duplicate).toBeGreaterThan(
      100,
    );

    const coverage = yield* withDatabase(getBankCoverage());
    for (const entry of coverage.accounts) {
      yield* log(
        `coverage ${entry.account.productLabel}: ${entry.covered.map((s) => `${s.start}..${s.end}`).join(", ")} gaps=${entry.gaps.length}`,
      );
    }
    yield* log(
      `completeMonths=${coverage.completeMonths.join(",")} dataThrough=${coverage.dataThrough}`,
    );

    const analysis = yield* withDatabase(getMoneyAnalysis());
    yield* log(
      `analysis: months=${analysis.months.length} recurring=${analysis.recurring.length} ` +
        `anomalies=${analysis.anomalies.length} suggestions=${analysis.suggestions.length} ` +
        `suggestionsUnavailable=${analysis.suggestionsUnavailable}`,
    );
    for (const month of analysis.months) {
      yield* log(
        `  ${month.month} complete=${month.complete} categories=${month.categories.length}`,
      );
    }

    const transfers = yield* withDatabase(getTransferMatches());
    yield* log(
      `transfers: confirmed=${transfers.matches.filter((m) => m.status === "confirmed").length} unresolved=${transfers.unresolved.length}`,
    );

    const review = yield* withDatabase(listTransactions({ kind: "attention" }));
    yield* log(`review queue: ${review.length}`);
    expect(analysis.months.length).toBeGreaterThan(0);
  }),
);

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, it } from "@effect/vitest";
import type { BankImportSource } from "@ironcage/contracts/schema";
import { RequestId, Sha256 } from "@ironcage/domain";
import { Effect, Schema } from "effect";

import { mintId } from "../../src/ids";
import { confirmBankImport, previewBankImport, type ImportDeps } from "../../src/money/import";
import { configureBankAccount, getBankCoverage } from "../../src/money/queries";
import { Postgres } from "../../src/persistence/postgres";
import { usePostgresTestDatabase } from "../persistence/postgres-test-database";

const database = usePostgresTestDatabase();
const fixturesDirectory = resolve(import.meta.dirname, "../fixtures/money/commbank");

const fixture = async (path: string) =>
  new Uint8Array(await readFile(resolve(fixturesDirectory, path)));

const sha = Schema.decodeUnknownSync(Sha256);
const artifacts = new Map<string, Uint8Array>();
const deps: ImportDeps = {
  identityKey: "integration-identity-key",
  artifacts: {
    put: (key, bytes) => {
      artifacts.set(key, bytes);
      return Promise.resolve();
    },
  },
};

const withDatabase = <A, E>(effect: Effect.Effect<A, E, Postgres>) =>
  effect.pipe(Effect.provide(Postgres.layerForRequest(database.connectionString())));

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

const structuredSource = (
  accountId: BankImportSource extends { accountId: infer Id } ? Id : never,
  csv: Uint8Array,
  ofx: Uint8Array,
): BankImportSource => ({
  kind: "commbank_structured",
  accountId,
  csv: { displayName: "CSVData.csv", bytes: csv },
  ofx: { displayName: "OFXData.ofx", bytes: ofx },
});

it.effect("imports, dedupes, and covers the spending offset end to end", () =>
  Effect.gen(function* () {
    artifacts.clear();

    const account = yield* withDatabase(
      configureBankAccount({
        requestId: yield* mintId(RequestId),
        payloadHash: sha("1".repeat(64)),
        productLabel: "Spending offset",
        accountType: "deposit",
        required: true,
        openedOn: null,
        closedOn: null,
      }),
    );

    const csvB = yield* Effect.promise(() => fixture("spending-offset/spending-offset-b.csv"));
    const ofxB = yield* Effect.promise(() => fixture("spending-offset/spending-offset-b.ofx"));
    const sourceB = structuredSource(account.id, csvB, ofxB);

    // Preview is stateless: nothing lands until confirm.
    const previewB = yield* withDatabase(previewBankImport(sourceB, deps));
    if (previewB.kind !== "ready") throw new Error("expected a ready preview");
    expect(previewB.preview.effects).toEqual({ new: 25, duplicate: 0, ambiguous: 0 });
    expect(previewB.preview.reviewCount).toBe(25);
    expect(yield* count("bank_imports")).toBe(0);
    expect(yield* count("bank_transactions")).toBe(0);

    const confirmB = yield* withDatabase(
      confirmBankImport(
        {
          source: sourceB,
          expectedBundleDigest: previewB.preview.bundleDigest,
          expectedPreviewFingerprint: previewB.preview.previewFingerprint,
          resolutions: [],
          requestId: yield* mintId(RequestId),
        },
        deps,
      ),
    );
    if (confirmB.kind !== "confirmed") throw new Error("expected a confirmed import");
    expect(confirmB.effects).toEqual({ new: 25, duplicate: 0, ambiguous: 0 });

    expect(yield* count("bank_transactions")).toBe(25);
    expect(yield* count("bank_observations")).toBe(50);
    expect(yield* count("bank_observation_links")).toBe(50);
    expect(yield* count("bank_source_identifiers")).toBe(25);
    expect(yield* count("transaction_splits")).toBe(25);
    expect(yield* count("bank_coverage_segments")).toBe(1);
    expect(yield* count("feed_events")).toBe(1);
    expect(artifacts.size).toBe(2);

    // The wider overlapping window adds only the rows the record lacks.
    const csvA = yield* Effect.promise(() => fixture("spending-offset/spending-offset-a.csv"));
    const ofxA = yield* Effect.promise(() => fixture("spending-offset/spending-offset-a.ofx"));
    const sourceA = structuredSource(account.id, csvA, ofxA);

    const previewA = yield* withDatabase(previewBankImport(sourceA, deps));
    if (previewA.kind !== "ready") throw new Error("expected a ready preview");
    expect(previewA.preview.effects).toEqual({ new: 15, duplicate: 25, ambiguous: 0 });

    const confirmA = yield* withDatabase(
      confirmBankImport(
        {
          source: sourceA,
          expectedBundleDigest: previewA.preview.bundleDigest,
          expectedPreviewFingerprint: previewA.preview.previewFingerprint,
          resolutions: [],
          requestId: yield* mintId(RequestId),
        },
        deps,
      ),
    );
    if (confirmA.kind !== "confirmed") throw new Error("expected a confirmed import");
    expect(yield* count("bank_transactions")).toBe(40);

    // Tier 0: the exact same bundle previews as already confirmed and a
    // reconfirm returns the earlier result without writing anything new.
    const replayPreview = yield* withDatabase(previewBankImport(sourceA, deps));
    if (replayPreview.kind !== "ready") throw new Error("expected a ready preview");
    expect(replayPreview.preview.alreadyConfirmed).toBe(true);

    const replayConfirm = yield* withDatabase(
      confirmBankImport(
        {
          source: sourceA,
          expectedBundleDigest: replayPreview.preview.bundleDigest,
          expectedPreviewFingerprint: replayPreview.preview.previewFingerprint,
          resolutions: [],
          requestId: yield* mintId(RequestId),
        },
        deps,
      ),
    );
    if (replayConfirm.kind !== "confirmed") throw new Error("expected a confirmed replay");
    expect(replayConfirm.importId).toBe(confirmA.importId);
    expect(yield* count("bank_transactions")).toBe(40);
    expect(yield* count("bank_imports")).toBe(2);

    // Coverage merged across both imports; freshness and data-through move.
    const coverage = yield* withDatabase(getBankCoverage());
    expect(coverage.accounts).toHaveLength(1);
    expect(coverage.accounts[0]!.covered).toEqual([{ start: "2031-12-11", end: "2032-01-29" }]);
    expect(coverage.accounts[0]!.account.identityBound).toBe(true);
    expect(coverage.dataThrough).toBe("2032-01-29");
  }),
);

it.effect("confirm refuses moved bytes and stale previews", () =>
  Effect.gen(function* () {
    const account = yield* withDatabase(
      configureBankAccount({
        requestId: yield* mintId(RequestId),
        payloadHash: sha("2".repeat(64)),
        productLabel: "Spending offset",
        accountType: "deposit",
        required: true,
        openedOn: null,
        closedOn: null,
      }),
    );

    const csv = yield* Effect.promise(() => fixture("spending-offset/spending-offset-c.csv"));
    const ofx = yield* Effect.promise(() => fixture("spending-offset/spending-offset-c.ofx"));
    const source = structuredSource(account.id, csv, ofx);

    const preview = yield* withDatabase(previewBankImport(source, deps));
    if (preview.kind !== "ready") throw new Error("expected a ready preview");

    const movedBytes = yield* withDatabase(
      Effect.flip(
        confirmBankImport(
          {
            source,
            expectedBundleDigest: sha("3".repeat(64)),
            expectedPreviewFingerprint: preview.preview.previewFingerprint,
            resolutions: [],
            requestId: yield* mintId(RequestId),
          },
          deps,
        ),
      ),
    );
    expect(movedBytes).toMatchObject({ _tag: "Conflict", reason: "ImportBytesChanged" });

    const stale = yield* withDatabase(
      Effect.flip(
        confirmBankImport(
          {
            source,
            expectedBundleDigest: preview.preview.bundleDigest,
            expectedPreviewFingerprint: sha("4".repeat(64)),
            resolutions: [],
            requestId: yield* mintId(RequestId),
          },
          deps,
        ),
      ),
    );
    expect(stale).toMatchObject({ _tag: "Stale", reason: "PreviewStale" });

    expect(yield* count("bank_imports")).toBe(0);
  }),
);

it.effect("a file for the wrong account is rejected before matching", () =>
  Effect.gen(function* () {
    const spending = yield* withDatabase(
      configureBankAccount({
        requestId: yield* mintId(RequestId),
        payloadHash: sha("5".repeat(64)),
        productLabel: "Spending offset",
        accountType: "deposit",
        required: true,
        openedOn: null,
        closedOn: null,
      }),
    );
    const savings = yield* withDatabase(
      configureBankAccount({
        requestId: yield* mintId(RequestId),
        payloadHash: sha("6".repeat(64)),
        productLabel: "Savings offset",
        accountType: "deposit",
        required: true,
        openedOn: null,
        closedOn: null,
      }),
    );

    const spendingSource = structuredSource(
      spending.id,
      yield* Effect.promise(() => fixture("spending-offset/spending-offset-a.csv")),
      yield* Effect.promise(() => fixture("spending-offset/spending-offset-a.ofx")),
    );
    const preview = yield* withDatabase(previewBankImport(spendingSource, deps));
    if (preview.kind !== "ready") throw new Error("expected a ready preview");
    yield* withDatabase(
      confirmBankImport(
        {
          source: spendingSource,
          expectedBundleDigest: preview.preview.bundleDigest,
          expectedPreviewFingerprint: preview.preview.previewFingerprint,
          resolutions: [],
          requestId: yield* mintId(RequestId),
        },
        deps,
      ),
    );

    // The same OFX identity uploaded against the savings account must refuse.
    const wrongAccount = structuredSource(
      savings.id,
      yield* Effect.promise(() => fixture("spending-offset/spending-offset-b.csv")),
      yield* Effect.promise(() => fixture("spending-offset/spending-offset-b.ofx")),
    );
    const blocked = yield* withDatabase(previewBankImport(wrongAccount, deps));
    expect(blocked).toMatchObject({
      kind: "blocked",
      block: { code: "AccountMismatch" },
    });
  }),
);

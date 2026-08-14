import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, it } from "@effect/vitest";
import type { BankImportSource } from "@ironcage/contracts/schema";
import { CategoryId, deriveRunId, RequestId, Sha256 } from "@ironcage/domain";
import { Effect, Schema } from "effect";

import { consumeCapabilityRun, consumeDeadLetter } from "../../src/ai/consume";
import { mintId } from "../../src/ids";
import { categorizeTransactions, getReviewQueue } from "../../src/money/categorize";
import { confirmBankImport, previewBankImport, type ImportDeps } from "../../src/money/import";
import { configureBankAccount } from "../../src/money/queries";
import { Postgres } from "../../src/persistence/postgres";
import { usePostgresTestDatabase } from "../persistence/postgres-test-database";

const database = usePostgresTestDatabase();
const fixturesDirectory = resolve(import.meta.dirname, "../fixtures/money/commbank");

const sha = Schema.decodeUnknownSync(Sha256);
const groceries = Schema.decodeUnknownSync(CategoryId)("01900000-0000-7000-8000-000000000002");

const deps: ImportDeps = {
  identityKey: "ai-consume-key",
  artifacts: { put: () => Promise.resolve() },
  extractStatement: () => Promise.reject(new Error("no statements in this test")),
};

const withDatabase = <A, E>(effect: Effect.Effect<A, E, Postgres>) =>
  effect.pipe(Effect.provide(Postgres.layerForRequest(database.connectionString())));

const importFixture = (accountId: BankImportSource["accountId"]) =>
  Effect.gen(function* () {
    const csv = yield* Effect.promise(
      async () =>
        new Uint8Array(
          await readFile(resolve(fixturesDirectory, "spending-offset/spending-offset-b.csv")),
        ),
    );
    const ofx = yield* Effect.promise(
      async () =>
        new Uint8Array(
          await readFile(resolve(fixturesDirectory, "spending-offset/spending-offset-b.ofx")),
        ),
    );
    const source: BankImportSource = {
      kind: "commbank_structured",
      accountId,
      csv: { displayName: "CSVData.csv", bytes: csv },
      ofx: { displayName: "OFXData.ofx", bytes: ofx },
    };
    const preview = yield* withDatabase(previewBankImport(source, deps));
    if (preview.kind !== "ready") throw new Error("expected a ready preview");
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
    if (confirmed.kind !== "confirmed") throw new Error("expected a confirmed import");
    return preview.preview.bundleDigest;
  });

const runMessage = (runId: string, bundleDigest: Sha256, transactionIds: readonly string[]) => ({
  runId,
  capability: "money.categorization",
  sleeveId: null,
  configVersion: 1,
  trigger: { _tag: "batch", bundleDigest, batchIndex: 0 },
  producedAt: new Date().toISOString(),
  result: {
    _tag: "Output",
    output: {
      suggestions: transactionIds.map((transactionId) => ({
        transactionId,
        categoryId: groceries,
        rationale: "looks like groceries",
      })),
    },
  },
  decisionRecord: {
    asked: "categorize 25 bank transactions",
    inputsSummary: { batchSize: 25 },
    decided: { suggestions: transactionIds.length },
    rationale: "test run",
    model: "test-model",
    gatewayLogIds: [],
    otelTraceId: "0af7651916cd43dd8448eb211c80319c",
    otelParentSpanIds: [],
  },
});

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

it.effect("suggestions land in the review queue exactly once per run identity", () =>
  Effect.gen(function* () {
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
    const bundleDigest = yield* importFixture(account.id);

    const queue = yield* withDatabase(getReviewQueue());
    const subjects = queue.slice(0, 2).map((entry) => entry.transactionId);
    const runId = yield* Effect.promise(() =>
      deriveRunId("money.categorization", 1, `${bundleDigest}|0`),
    );
    const message = runMessage(runId, bundleDigest, subjects);

    const outcome = yield* withDatabase(consumeCapabilityRun(message));
    expect(outcome).toEqual({ kind: "accepted", suggestions: 2 });
    expect(yield* count("capability_outputs")).toBe(1);
    expect(yield* count("decision_records")).toBe(1);

    const suggested = yield* withDatabase(getReviewQueue());
    const withSuggestion = suggested.filter((entry) => entry.suggestion !== null);
    expect(withSuggestion).toHaveLength(2);
    expect(withSuggestion[0]!.suggestion!.categoryName).toBe("groceries");

    // At-least-once delivery: the same body is dropped as a duplicate.
    expect(yield* withDatabase(consumeCapabilityRun(message))).toEqual({ kind: "duplicate" });
    expect(yield* count("categorization_suggestions")).toBe(2);

    // The same run ID with different content is an invariant violation.
    const collision = yield* withDatabase(
      consumeCapabilityRun(runMessage(runId, bundleDigest, [subjects[0]!])),
    );
    expect(collision).toEqual({ kind: "collision" });
    expect(
      yield* count(
        "feed_events WHERE event_type = 'decision_record_lost' AND severity = 'critical'",
      ),
    ).toBe(1);

    // Accepting the suggested category settles the suggestion as accepted.
    const subject = suggested.find((entry) => entry.transactionId === subjects[0])!;
    yield* withDatabase(
      categorizeTransactions({
        requestId: yield* mintId(RequestId),
        payloadHash: sha("2".repeat(64)),
        changes: [
          {
            transactionId: subject.transactionId,
            splits: [{ categoryId: groceries, amount: subject.amount }],
          },
        ],
        createRules: [],
      }),
    );
    expect(yield* count("categorization_suggestions WHERE status = 'accepted'")).toBe(1);
    expect(yield* count("categorization_suggestions WHERE status = 'pending'")).toBe(1);
  }),
);

it.effect("a failed run and a dead letter leave warnings, never suggestions", () =>
  Effect.gen(function* () {
    const account = yield* withDatabase(
      configureBankAccount({
        requestId: yield* mintId(RequestId),
        payloadHash: sha("3".repeat(64)),
        productLabel: "Spending offset",
        accountType: "deposit",
        required: true,
        openedOn: null,
        closedOn: null,
      }),
    );
    const bundleDigest = yield* importFixture(account.id);
    const runId = yield* Effect.promise(() =>
      deriveRunId("money.categorization", 1, `${bundleDigest}|0`),
    );

    const failed = {
      ...runMessage(runId, bundleDigest, []),
      result: {
        _tag: "Failed",
        failure: { reason: "MalformedAnswer", detail: "prose instead of JSON" },
      },
    };
    expect(yield* withDatabase(consumeCapabilityRun(failed))).toEqual({ kind: "failed_run" });
    expect(yield* count("categorization_suggestions")).toBe(0);
    expect(yield* count("feed_events WHERE event_type = 'ai_run_failed'")).toBe(1);

    // Rubbish never reaches the record; the queue's retry path owns it.
    expect(yield* withDatabase(consumeCapabilityRun({ nonsense: true }))).toEqual({
      kind: "undecodable",
    });

    yield* withDatabase(consumeDeadLetter("message-1", { some: "body" }));
    yield* withDatabase(consumeDeadLetter("message-1", { some: "body" }));
    expect(yield* count("feed_events WHERE event_type = 'decision_record_lost'")).toBe(1);
  }),
);

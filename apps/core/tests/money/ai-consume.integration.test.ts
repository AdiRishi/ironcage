import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, it } from "@effect/vitest";
import type { BankImportSource } from "@ironcage/contracts/schema";
import { CategoryId, RequestId, Sha256 } from "@ironcage/domain";
import { Effect, Schema } from "effect";

import { consumeCapabilityRun, consumeDeadLetter } from "../../src/ai/consume";
import { mintId } from "../../src/ids";
import { configureBankAccount } from "../../src/money/accounts/service";
import {
  listPendingCategorizationDispatches,
  type CategorizationDispatch,
} from "../../src/money/categorization/dispatch";
import { categorizeTransactions, listTransactions } from "../../src/money/categorization/service";
import {
  confirmBankImport,
  previewBankImport,
  type ImportDeps,
} from "../../src/money/import/service";
import { Postgres } from "../../src/persistence/postgres";
import { usePostgresTestDatabase } from "../persistence/postgres-test-database";

const database = usePostgresTestDatabase();
const fixturesDirectory = resolve(import.meta.dirname, "../fixtures/money/commbank");

const sha = Schema.decodeUnknownSync(Sha256);
const groceries = Schema.decodeUnknownSync(CategoryId)("01900000-0000-7000-8000-000000000002");

const deps: ImportDeps = {
  identityKey: "ai-consume-key",
  extractStatement: () => Promise.reject(new Error("statement extraction not expected")),
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
    const pending = yield* withDatabase(
      Effect.gen(function* () {
        const postgres = yield* Postgres;
        return yield* postgres.readTransaction((sql) =>
          listPendingCategorizationDispatches(sql, 10),
        );
      }),
    );
    if (pending[0] === undefined) throw new Error("expected a categorization dispatch");
    return pending[0];
  });

const runMessage = (dispatch: CategorizationDispatch, transactionIds: readonly string[]) => ({
  runId: dispatch.runId,
  capability: "money.categorization",
  sleeveId: null,
  configVersion: dispatch.configVersion,
  trigger: {
    _tag: "batch",
    bundleDigest: dispatch.bundleDigest,
    batchIndex: dispatch.batchIndex,
    inputDigest: dispatch.inputDigest,
  },
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
    model: dispatch.model,
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

it.effect("a run's answer is applied exactly once per run identity", () =>
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
    const dispatch = yield* importFixture(account.id);

    const subjects = dispatch.batch.map((entry) => entry.transactionId);
    const message = runMessage(dispatch, subjects);

    const outcome = yield* withDatabase(consumeCapabilityRun(message));
    expect(outcome).toEqual({ kind: "accepted", filed: subjects.length });
    expect(yield* count("capability_outputs")).toBe(1);
    expect(yield* count("decision_records")).toBe(1);
    expect(yield* count("transaction_splits WHERE provenance = 'ai'")).toBe(subjects.length);
    expect(yield* count("feed_events WHERE event_type = 'ai_categorized'")).toBe(1);

    // The two rows are filed and open to change; the rest still need a hand,
    // and those sort first.
    const suggested = yield* withDatabase(listTransactions({ kind: "attention" }));
    const filed = suggested.filter((entry) => entry.filedBy === "ai");
    expect(filed).toHaveLength(subjects.length);
    expect(filed[0]!.splits[0]!.categoryName).toBe("groceries");
    expect(filed[0]!.rationale).toBe("looks like groceries");
    expect(suggested.findIndex((entry) => entry.filedBy === "ai")).toBe(0);

    // At-least-once delivery: the same body is dropped as a duplicate.
    expect(yield* withDatabase(consumeCapabilityRun(message))).toEqual({ kind: "duplicate" });
    expect(yield* count("categorization_assignments")).toBe(subjects.length);
    expect(yield* count("transaction_splits WHERE provenance = 'ai'")).toBe(subjects.length);

    // The same run ID with different content is an invariant violation.
    const collision = yield* withDatabase(
      consumeCapabilityRun(runMessage(dispatch, [subjects[0]!])),
    );
    expect(collision).toEqual({ kind: "collision" });
    expect(
      yield* count(
        "feed_events WHERE event_type = 'decision_record_lost' AND severity = 'critical'",
      ),
    ).toBe(1);

    // Choosing the model's own category keeps its assignment; the row leaves
    // the queue either way because it is now the operator's.
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
    expect(yield* count("categorization_assignments WHERE status = 'kept'")).toBe(1);
    expect(yield* count("categorization_assignments WHERE status = 'applied'")).toBe(
      subjects.length - 1,
    );
    expect(
      (yield* withDatabase(listTransactions({ kind: "attention" }))).some(
        (entry) => entry.transactionId === subject.transactionId,
      ),
    ).toBe(false);
  }),
);

it.effect("a failed run and a dead letter leave warnings and file nothing", () =>
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
    const dispatch = yield* importFixture(account.id);

    const failed = {
      ...runMessage(
        dispatch,
        dispatch.batch.map((entry) => entry.transactionId),
      ),
      result: {
        _tag: "Failed",
        failure: { reason: "MalformedAnswer", detail: "prose instead of JSON" },
      },
    };
    expect(yield* withDatabase(consumeCapabilityRun(failed))).toEqual({ kind: "failed_run" });
    expect(yield* count("categorization_assignments")).toBe(0);
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

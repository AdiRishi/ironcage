import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, it } from "@effect/vitest";
import type { BankImportSource, SplitInput } from "@ironcage/contracts/schema";
import { Aud, CategoryId, RequestId, Sha256 } from "@ironcage/domain";
import { BigDecimal, Effect, Schema } from "effect";

import { mintId } from "../../src/ids";
import {
  categorizeTransactions,
  getCategorizationRules,
  getReviewQueue,
} from "../../src/money/categorize";
import { confirmBankImport, previewBankImport, type ImportDeps } from "../../src/money/import";
import { configureBankAccount } from "../../src/money/queries";
import { Postgres } from "../../src/persistence/postgres";
import { usePostgresTestDatabase } from "../persistence/postgres-test-database";

const database = usePostgresTestDatabase();
const fixturesDirectory = resolve(import.meta.dirname, "../fixtures/money/commbank");

const sha = Schema.decodeUnknownSync(Sha256);
const categoryId = Schema.decodeUnknownSync(CategoryId);
const aud = Schema.decodeUnknownSync(Aud);
const groceries = categoryId("01900000-0000-7000-8000-000000000002");
const dining = categoryId("01900000-0000-7000-8000-000000000003");

const deps: ImportDeps = {
  identityKey: "categorize-key",
  artifacts: { put: () => Promise.resolve() },
};

const withDatabase = <A, E>(effect: Effect.Effect<A, E, Postgres>) =>
  effect.pipe(Effect.provide(Postgres.layerForRequest(database.connectionString())));

const importFixture = (accountId: BankImportSource["accountId"], name: string) =>
  Effect.gen(function* () {
    const csv = yield* Effect.promise(
      async () =>
        new Uint8Array(await readFile(resolve(fixturesDirectory, `spending-offset/${name}.csv`))),
    );
    const ofx = yield* Effect.promise(
      async () =>
        new Uint8Array(await readFile(resolve(fixturesDirectory, `spending-offset/${name}.ofx`))),
    );
    const source: BankImportSource = {
      kind: "commbank_structured",
      accountId,
      csv: { displayName: `${name}.csv`, bytes: csv },
      ofx: { displayName: `${name}.ofx`, bytes: ofx },
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
    return { preview: preview.preview, confirmed };
  });

it.effect("corrections drain the review queue and teach rules that apply forward", () =>
  Effect.gen(function* () {
    const account = yield* withDatabase(
      configureBankAccount({
        requestId: yield* mintId(RequestId),
        payloadHash: sha("a".repeat(64)),
        productLabel: "Spending offset",
        accountType: "deposit",
        required: true,
        openedOn: null,
        closedOn: null,
      }),
    );

    yield* importFixture(account.id, "spending-offset-b");

    const queue = yield* withDatabase(getReviewQueue());
    expect(queue).toHaveLength(25);

    // A manual correction with a two-way split, plus a correction rule that
    // matches every fixture narrative from now on.
    const subject = queue[0]!;
    const half = BigDecimal.divideUnsafe(subject.amount, BigDecimal.fromStringUnsafe("2"));
    const rest = BigDecimal.subtract(subject.amount, half);
    const splits: SplitInput[] = [
      { categoryId: groceries, amount: aud(BigDecimal.format(half)) },
      { categoryId: dining, amount: aud(BigDecimal.format(rest)) },
    ];

    const result = yield* withDatabase(
      categorizeTransactions({
        requestId: yield* mintId(RequestId),
        payloadHash: sha("b".repeat(64)),
        changes: [{ transactionId: subject.transactionId, splits }],
        createRules: [
          {
            predicate: { narrativeContains: ["fixture spending offset"] },
            categoryId: dining,
          },
        ],
      }),
    );
    expect(result).toEqual({ updated: 1, rulesCreated: 1 });

    expect(yield* withDatabase(getReviewQueue())).toHaveLength(24);

    const rules = yield* withDatabase(getCategorizationRules());
    expect(rules).toHaveLength(1);
    expect(rules[0]!.createdBy).toBe("correction");

    // The wider window's 15 new rows all hit the rule at preview and confirm,
    // so none of them lands in the review queue.
    const wider = yield* importFixture(account.id, "spending-offset-a");
    expect(wider.preview.effects).toEqual({ new: 15, duplicate: 25, ambiguous: 0 });
    expect(wider.preview.reviewCount).toBe(0);
    expect(
      wider.preview.candidates
        .filter((candidate) => candidate.status === "new")
        .every((candidate) => candidate.category === "dining"),
    ).toBe(true);

    expect(yield* withDatabase(getReviewQueue())).toHaveLength(24);
  }),
);

it.effect("a split set that does not sum to the transaction refuses", () =>
  Effect.gen(function* () {
    const account = yield* withDatabase(
      configureBankAccount({
        requestId: yield* mintId(RequestId),
        payloadHash: sha("c".repeat(64)),
        productLabel: "Spending offset",
        accountType: "deposit",
        required: true,
        openedOn: null,
        closedOn: null,
      }),
    );
    yield* importFixture(account.id, "spending-offset-c");

    const queue = yield* withDatabase(getReviewQueue());
    const subject = queue[0]!;

    const error = yield* withDatabase(
      Effect.flip(
        categorizeTransactions({
          requestId: yield* mintId(RequestId),
          payloadHash: sha("d".repeat(64)),
          changes: [
            {
              transactionId: subject.transactionId,
              splits: [{ categoryId: groceries, amount: aud("0.01") }],
            },
          ],
          createRules: [],
        }),
      ),
    );
    expect(error).toMatchObject({ _tag: "ValidationFailed", reason: "SplitSumMismatch" });
  }),
);

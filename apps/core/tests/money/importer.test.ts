import { it } from "@effect/vitest";
import {
  BankAccountId,
  CalendarDate,
  RequestId,
  type BankImportSource,
  type RegisterBankAccount,
} from "@ironcage/domain";
import { Effect, Ref, Schema } from "effect";
import { describe, expect } from "vitest";

import { MoneyImports } from "../../src/money/importer";
import homeLoanCsv from "../fixtures/money/commbank/home-loan/home-loan-a.csv?bytes";
import homeLoanOfx from "../fixtures/money/commbank/home-loan/home-loan-a.ofx?bytes";
import spendingACsv from "../fixtures/money/commbank/spending-offset/spending-offset-a.csv?bytes";
import spendingAOfx from "../fixtures/money/commbank/spending-offset/spending-offset-a.ofx?bytes";
import spendingBCsv from "../fixtures/money/commbank/spending-offset/spending-offset-b.csv?bytes";
import spendingBOfx from "../fixtures/money/commbank/spending-offset/spending-offset-b.ofx?bytes";
import spendingCCsv from "../fixtures/money/commbank/spending-offset/spending-offset-c.csv?bytes";
import spendingCOfx from "../fixtures/money/commbank/spending-offset/spending-offset-c.ofx?bytes";
import { makeMoneyImportTestKit } from "../support/money-imports";

const accountId = Schema.decodeUnknownSync(BankAccountId)("018f0000-0000-7000-8000-000000001001");
const homeLoanAccountId = Schema.decodeUnknownSync(BankAccountId)(
  "018f0000-0000-7000-8000-000000001002",
);
const duplicateProfileAccountId = Schema.decodeUnknownSync(BankAccountId)(
  "018f0000-0000-7000-8000-000000001003",
);
const requestId = (suffix: string) =>
  Schema.decodeUnknownSync(RequestId)(`018f0000-0000-7000-8000-${suffix.padStart(12, "0")}`);

const account: RegisterBankAccount = {
  id: accountId,
  profile: "spending-offset",
  label: "Spending offset",
  maskedSuffix: "0001",
  identity: {
    messageSet: "bank",
    bankId: "000000",
    accountId: "10000001",
    accountType: "SAVINGS",
  },
  required: true,
  effectiveFrom: Schema.decodeUnknownSync(CalendarDate)("2024-01-01"),
};

const homeLoanAccount: RegisterBankAccount = {
  id: homeLoanAccountId,
  profile: "home-loan",
  label: "Home loan",
  maskedSuffix: "0003",
  identity: {
    messageSet: "bank",
    bankId: "000000",
    accountId: "400000003",
    accountType: "CREDITLINE",
  },
  required: true,
  effectiveFrom: Schema.decodeUnknownSync(CalendarDate)("2024-08-08"),
};

const duplicateProfileAccount: RegisterBankAccount = {
  ...account,
  id: duplicateProfileAccountId,
  label: "A second spending offset",
  maskedSuffix: "0002",
  identity: { ...account.identity, accountId: "10000002" },
};

const source = (csv: Uint8Array, ofx: Uint8Array, name: string): BankImportSource => ({
  kind: "commbank_structured",
  accountId,
  csv: { name: `${name}.csv`, mediaType: "text/csv", bytes: csv },
  ofx: { name: `${name}.ofx`, mediaType: "application/x-ofx", bytes: ofx },
});

const a = source(spendingACsv, spendingAOfx, "spending-a");
const b = source(spendingBCsv, spendingBOfx, "spending-b");
const c = source(spendingCCsv, spendingCOfx, "spending-c");
const homeLoan: BankImportSource = {
  kind: "commbank_structured",
  accountId: homeLoanAccountId,
  csv: { name: "home-loan.csv", mediaType: "text/csv", bytes: homeLoanCsv },
  ofx: { name: "home-loan.ofx", mediaType: "application/x-ofx", bytes: homeLoanOfx },
};

describe("MoneyImports", () => {
  it.effect("keeps each configured product profile bound to one bank account", () =>
    Effect.gen(function* () {
      const kit = yield* makeMoneyImportTestKit;

      yield* Effect.gen(function* () {
        const imports = yield* MoneyImports;
        yield* imports.registerAccount({ account, requestId: requestId("21") });

        const conflict = yield* Effect.flip(
          imports.registerAccount({
            account: duplicateProfileAccount,
            requestId: requestId("22"),
          }),
        );

        expect(conflict).toMatchObject({
          _tag: "Conflict",
          reason: "BankAccountAlreadyRegistered",
        });
      }).pipe(Effect.provide(kit.layer));
    }),
  );

  it.effect("keeps preview stateless and confirms overlapping bundles exactly once", () =>
    Effect.gen(function* () {
      const kit = yield* makeMoneyImportTestKit;

      yield* Effect.gen(function* () {
        const imports = yield* MoneyImports;
        yield* imports.registerAccount({ account, requestId: requestId("1") });

        const previewA = yield* imports.preview(b);
        const afterPreview = yield* Ref.get(kit.state);
        expect(afterPreview.importCommits).toBe(0);
        expect(afterPreview.imports).toHaveLength(0);
        expect(previewA.verdicts.every((verdict) => verdict._tag === "New")).toBe(true);

        const confirmedA = yield* imports.confirm({
          source: b,
          expectedBundleDigest: previewA.bundleDigest,
          expectedPreviewFingerprint: previewA.previewFingerprint,
          resolutions: [],
          requestId: requestId("2"),
        });
        expect(confirmedA.newTransactions).toBe(previewA.logicalTransactionCount);

        const previewCBeforeOverlap = yield* imports.preview(c);
        const previewB = yield* imports.preview(a);
        expect(previewB.verdicts.some((verdict) => verdict._tag === "Duplicate")).toBe(true);
        expect(previewB.verdicts.some((verdict) => verdict._tag === "New")).toBe(true);

        const confirmedB = yield* imports.confirm({
          source: a,
          expectedBundleDigest: previewB.bundleDigest,
          expectedPreviewFingerprint: previewB.previewFingerprint,
          resolutions: [],
          requestId: requestId("3"),
        });
        expect(confirmedB.duplicates).toBeGreaterThan(0);
        expect(confirmedB.newTransactions).toBeGreaterThan(0);

        const stale = yield* Effect.flip(
          imports.confirm({
            source: c,
            expectedBundleDigest: previewCBeforeOverlap.bundleDigest,
            expectedPreviewFingerprint: previewCBeforeOverlap.previewFingerprint,
            resolutions: [],
            requestId: requestId("4"),
          }),
        );
        expect(stale._tag).toBe("Stale");

        const confirmedAAgain = yield* imports.confirm({
          source: b,
          expectedBundleDigest: previewA.bundleDigest,
          expectedPreviewFingerprint: previewA.previewFingerprint,
          resolutions: [],
          requestId: requestId("5"),
        });
        expect(confirmedAAgain).toEqual(confirmedA);

        const finalState = yield* Ref.get(kit.state);
        expect(finalState.importCommits).toBe(2);
        expect(finalState.imports).toHaveLength(2);
        expect(finalState.history).toHaveLength(2);
        expect(finalState.transactions).toHaveLength(
          confirmedA.newTransactions + confirmedB.newTransactions,
        );
        expect(
          finalState.transactions.reduce(
            (total, transaction) => total + transaction.observations.length,
            0,
          ),
        ).toBe(confirmedA.observations + confirmedB.observations);
      }).pipe(Effect.provide(kit.layer));
    }),
  );

  it.effect("matches the loan repayment in both accounts as one owned transfer", () =>
    Effect.gen(function* () {
      const kit = yield* makeMoneyImportTestKit;

      yield* Effect.gen(function* () {
        const imports = yield* MoneyImports;
        yield* imports.registerAccount({ account, requestId: requestId("31") });
        yield* imports.registerAccount({ account: homeLoanAccount, requestId: requestId("32") });

        const spending = yield* imports.preview(b);
        yield* imports.confirm({
          source: b,
          expectedBundleDigest: spending.bundleDigest,
          expectedPreviewFingerprint: spending.previewFingerprint,
          resolutions: [],
          requestId: requestId("33"),
        });
        expect((yield* Ref.get(kit.state)).transferPairs).toHaveLength(0);

        const loan = yield* imports.preview(homeLoan);
        yield* imports.confirm({
          source: homeLoan,
          expectedBundleDigest: loan.bundleDigest,
          expectedPreviewFingerprint: loan.previewFingerprint,
          resolutions: [],
          requestId: requestId("34"),
        });

        // The corpus records one A$3,908.00 repayment leaving the offset on
        // 28 July and the same amount arriving at the loan that day.
        expect((yield* Ref.get(kit.state)).transferPairs).toMatchObject([{ status: "confirmed" }]);

        const overlapping = yield* imports.preview(c);
        yield* imports.confirm({
          source: c,
          expectedBundleDigest: overlapping.bundleDigest,
          expectedPreviewFingerprint: overlapping.previewFingerprint,
          resolutions: [],
          requestId: requestId("35"),
        });
        expect((yield* Ref.get(kit.state)).transferPairs).toHaveLength(1);
      }).pipe(Effect.provide(kit.layer));
    }),
  );

  it.effect("emits monthly coverage gaps once and closes them when the account catches up", () =>
    Effect.gen(function* () {
      const kit = yield* makeMoneyImportTestKit;

      yield* Effect.gen(function* () {
        const imports = yield* MoneyImports;
        yield* imports.registerAccount({ account, requestId: requestId("11") });
        yield* imports.registerAccount({ account: homeLoanAccount, requestId: requestId("12") });

        const spendingPreview = yield* imports.preview(b);
        yield* imports.preview(homeLoan);
        expect((yield* Ref.get(kit.state)).coverageEvents).toEqual([]);

        yield* imports.confirm({
          source: b,
          expectedBundleDigest: spendingPreview.bundleDigest,
          expectedPreviewFingerprint: spendingPreview.previewFingerprint,
          resolutions: [],
          requestId: requestId("13"),
        });
        expect((yield* Ref.get(kit.state)).coverageEvents).toEqual(["bank_gap_detected"]);

        const freshHomeLoanPreview = yield* imports.preview(homeLoan);
        yield* imports.confirm({
          source: homeLoan,
          expectedBundleDigest: freshHomeLoanPreview.bundleDigest,
          expectedPreviewFingerprint: freshHomeLoanPreview.previewFingerprint,
          resolutions: [],
          requestId: requestId("14"),
        });

        const events = (yield* Ref.get(kit.state)).coverageEvents;
        expect(events.filter((event) => event === "bank_gap_closed")).toEqual(["bank_gap_closed"]);
        expect(events.filter((event) => event === "bank_gap_detected").length).toBeGreaterThan(1);
      }).pipe(Effect.provide(kit.layer));
    }),
  );
});

import { it } from "@effect/vitest";
import {
  BankAccountId,
  BankTransactionId,
  CalendarDate,
  CalendarMonth,
  CategoryId,
  Currency,
  Money,
  RequestId,
  TransferMatchId,
  uncategorizedCategoryId,
  type BankAccount,
  type Category,
} from "@ironcage/domain";
import { Effect, Ref, Schema } from "effect";
import { describe, expect } from "vitest";

import { MoneyLedger } from "../../src/money/ledger";
import type { MoneyLedgerSnapshot } from "../../src/money/ledger-repository";
import { makeMoneyLedgerTestKit } from "../support/money-ledger";

const accountId = Schema.decodeUnknownSync(BankAccountId)("018f0000-0000-7000-8000-000000003001");
const transactionId = Schema.decodeUnknownSync(BankTransactionId)(
  "018f0000-0000-7000-8000-000000003002",
);
const categoryId = Schema.decodeUnknownSync(CategoryId)("018f0000-0000-7000-8000-000000003003");
const otherCategoryId = Schema.decodeUnknownSync(CategoryId)(
  "018f0000-0000-7000-8000-000000003004",
);
const competingDebitId = Schema.decodeUnknownSync(BankTransactionId)(
  "018f0000-0000-7000-8000-000000003005",
);
const firstCreditId = Schema.decodeUnknownSync(BankTransactionId)(
  "018f0000-0000-7000-8000-000000003006",
);
const secondCreditId = Schema.decodeUnknownSync(BankTransactionId)(
  "018f0000-0000-7000-8000-000000003007",
);
const firstTransferId = Schema.decodeUnknownSync(TransferMatchId)(
  "018f0000-0000-7000-8000-000000003008",
);
const secondTransferId = Schema.decodeUnknownSync(TransferMatchId)(
  "018f0000-0000-7000-8000-000000003009",
);
const date = Schema.decodeUnknownSync(CalendarDate);
const money = Schema.decodeUnknownSync(Money);
const requestId = (value: number) =>
  Schema.decodeUnknownSync(RequestId)(
    `018f0000-0000-7000-8000-${value.toString().padStart(12, "0")}`,
  );

const account: BankAccount = {
  id: accountId,
  profile: "spending-offset",
  label: "Spending offset",
  type: "deposit",
  maskedSuffix: "0001",
  currency: Schema.decodeUnknownSync(Currency)("AUD"),
  required: true,
  effectiveFrom: date("2025-01-01"),
  effectiveTo: null,
};
const categories: readonly Category[] = [
  {
    id: uncategorizedCategoryId,
    version: 1,
    name: "Uncategorized",
    kind: "expense",
    system: true,
  },
  {
    id: categoryId,
    version: 1,
    name: "<Dining & Groceries>",
    kind: "expense",
    system: false,
  },
  {
    id: otherCategoryId,
    version: 1,
    name: "Other",
    kind: "expense",
    system: false,
  },
];

const snapshot: MoneyLedgerSnapshot = {
  analysis: {
    accounts: [account],
    coverage: [{ accountId, start: date("2025-12-01"), end: date("2026-03-31") }],
    transactions: [
      {
        id: transactionId,
        accountId,
        postedDate: date("2026-03-12"),
        amount: money("-10"),
        payee: "Corner shop",
        narrative: "Corner shop",
        ownedTransfer: false,
        splits: [
          {
            categoryId: uncategorizedCategoryId,
            categoryName: "Uncategorized",
            categoryKind: "expense",
            amount: money("-10"),
          },
        ],
      },
    ],
  },
  categories,
  rules: [],
  review: [
    {
      transactionId,
      accountId,
      postedDate: date("2026-03-12"),
      amount: money("-10"),
      narrative: "Corner shop",
      splits: [{ categoryId: uncategorizedCategoryId, amount: money("-10") }],
      suggestion: null,
    },
  ],
  transfers: [],
  confirmedTransferTransactionIds: [],
  balances: [],
  reports: [],
  requests: [],
};

describe("MoneyLedger", () => {
  it.effect("enforces exact splits, replays mutations, and renders a grounded report", () =>
    Effect.gen(function* () {
      const kit = yield* makeMoneyLedgerTestKit(snapshot);

      yield* Effect.gen(function* () {
        const ledger = yield* MoneyLedger;
        const unbalanced = yield* Effect.flip(
          ledger.categorize({
            assignments: [
              {
                transactionId,
                splits: [{ categoryId, amount: money("-9") }],
                acceptedSuggestionId: null,
              },
            ],
            requestId: requestId(1),
          }),
        );
        expect(unbalanced).toMatchObject({
          _tag: "ValidationFailed",
          reason: "UnbalancedTransactionSplits",
        });
        expect((yield* Ref.get(kit.state)).categorizeCommits).toBe(0);

        const assignment = {
          assignments: [
            {
              transactionId,
              splits: [{ categoryId, amount: money("-10") }],
              acceptedSuggestionId: null,
            },
          ],
          requestId: requestId(2),
        } as const;
        const categorized = yield* ledger.categorize(assignment);
        expect(categorized).toEqual({ requestId: requestId(2) });
        expect(yield* ledger.categorize(assignment)).toEqual(categorized);
        expect((yield* Ref.get(kit.state)).categorizeCommits).toBe(1);

        const collision = yield* Effect.flip(
          ledger.categorize({
            assignments: [
              {
                transactionId,
                splits: [{ categoryId: otherCategoryId, amount: money("-10") }],
                acceptedSuggestionId: null,
              },
            ],
            requestId: requestId(2),
          }),
        );
        expect(collision).toMatchObject({ _tag: "Conflict", reason: "RequestIdCollision" });

        const report = yield* ledger.generateReport({
          month: Schema.decodeUnknownSync(CalendarMonth)("2026-03"),
          requestId: requestId(3),
        });
        expect(report.analysis.coverage._tag).toBe("Complete");
        expect(report.readAt).toBeNull();
        expect(report.supportingTransactionIds).toEqual([transactionId]);
        expect((yield* Ref.get(kit.state)).reportCommits).toBe(1);

        const rendered = yield* ledger.getReport(report.id);
        expect(rendered.html).toContain("&lt;Dining &amp; Groceries&gt;");
        expect(rendered.html).not.toContain("<Dining & Groceries>");

        const sameReport = yield* ledger.generateReport({
          month: report.month,
          requestId: requestId(4),
        });
        expect(sameReport).toEqual(report);
        expect((yield* Ref.get(kit.state)).reportCommits).toBe(1);

        const markedRead = yield* ledger.markReportRead({ id: report.id, requestId: requestId(6) });
        expect(markedRead.readAt).not.toBeNull();
        expect(yield* ledger.markReportRead({ id: report.id, requestId: requestId(6) })).toEqual(
          markedRead,
        );
        expect((yield* ledger.listReports)[0]?.readAt).toEqual(markedRead.readAt);
      }).pipe(Effect.provide(kit.layer));
    }),
  );

  it.effect("resolves every competing transfer when one pairing is confirmed", () =>
    Effect.gen(function* () {
      const transferSnapshot: MoneyLedgerSnapshot = {
        ...snapshot,
        transfers: [
          {
            id: firstTransferId,
            debitTransactionId: competingDebitId,
            creditTransactionId: firstCreditId,
            amount: money("100"),
            debitDate: date("2026-03-12"),
            creditDate: date("2026-03-13"),
            method: "amount_date",
            status: "proposed",
          },
          {
            id: secondTransferId,
            debitTransactionId: competingDebitId,
            creditTransactionId: secondCreditId,
            amount: money("100"),
            debitDate: date("2026-03-12"),
            creditDate: date("2026-03-14"),
            method: "amount_date",
            status: "proposed",
          },
        ],
      };
      const kit = yield* makeMoneyLedgerTestKit(transferSnapshot);

      yield* Effect.gen(function* () {
        const ledger = yield* MoneyLedger;
        const input = {
          id: firstTransferId,
          decision: "confirmed" as const,
          requestId: requestId(5),
        };

        expect(yield* ledger.resolveTransfer(input)).toEqual({ requestId: requestId(5) });
        expect(yield* ledger.resolveTransfer(input)).toEqual({ requestId: requestId(5) });
        expect(yield* ledger.transferReview).toEqual([]);

        const current = yield* Ref.get(kit.state);
        expect(current.snapshot.confirmedTransferTransactionIds).toEqual([
          competingDebitId,
          firstCreditId,
        ]);
      }).pipe(Effect.provide(kit.layer));
    }),
  );
});

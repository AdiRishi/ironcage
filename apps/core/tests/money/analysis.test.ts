import {
  BankAccountId,
  BankTransactionId,
  CalendarDate,
  CalendarMonth,
  CategoryId,
  Currency,
  Money,
  type BankAccount,
  type CategoryKind,
} from "@ironcage/domain";
import { BigDecimal, Schema } from "effect";
import { describe, expect, test } from "vitest";

import {
  analyzeMoney,
  type AnalysisTransaction,
  type MoneyAnalysisRecord,
} from "../../src/money/analysis";

const accountId = Schema.decodeUnknownSync(BankAccountId)("018f0000-0000-7000-8000-000000002001");
const groceriesId = Schema.decodeUnknownSync(CategoryId)("018f0000-0000-7000-8000-000000002002");
const subscriptionsId = Schema.decodeUnknownSync(CategoryId)(
  "018f0000-0000-7000-8000-000000002003",
);
const incomeId = Schema.decodeUnknownSync(CategoryId)("018f0000-0000-7000-8000-000000002004");
const transferId = Schema.decodeUnknownSync(CategoryId)("018f0000-0000-7000-8000-000000002005");
const date = Schema.decodeUnknownSync(CalendarDate);
const month = Schema.decodeUnknownSync(CalendarMonth);
const money = Schema.decodeUnknownSync(Money);
const transactionId = (value: number) =>
  Schema.decodeUnknownSync(BankTransactionId)(
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
  effectiveFrom: date("2024-01-01"),
  effectiveTo: null,
};

const transaction = (input: {
  readonly id: number;
  readonly postedDate: string;
  readonly amount: string;
  readonly payee: string;
  readonly categoryId: CategoryId;
  readonly categoryName: string;
  readonly categoryKind?: CategoryKind;
  readonly ownedTransfer?: boolean;
}): AnalysisTransaction => ({
  id: transactionId(input.id),
  accountId,
  postedDate: date(input.postedDate),
  amount: money(input.amount),
  payee: input.payee,
  narrative: input.payee,
  ownedTransfer: input.ownedTransfer ?? false,
  splits: [
    {
      categoryId: input.categoryId,
      categoryName: input.categoryName,
      categoryKind: input.categoryKind ?? "expense",
      amount: money(input.amount),
    },
  ],
});

const completeRecord = (transactions: readonly AnalysisTransaction[]): MoneyAnalysisRecord => ({
  accounts: [account],
  coverage: [{ accountId, start: date("2024-01-01"), end: date("2026-03-31") }],
  transactions,
});

const baseTransactions = [
  transaction({
    id: 1,
    postedDate: "2025-12-15",
    amount: "-100",
    payee: "Grocer December",
    categoryId: groceriesId,
    categoryName: "Groceries",
  }),
  transaction({
    id: 2,
    postedDate: "2026-01-15",
    amount: "-200",
    payee: "Grocer January",
    categoryId: groceriesId,
    categoryName: "Groceries",
  }),
  transaction({
    id: 3,
    postedDate: "2026-02-15",
    amount: "-300",
    payee: "Grocer February",
    categoryId: groceriesId,
    categoryName: "Groceries",
  }),
  transaction({
    id: 4,
    postedDate: "2026-03-10",
    amount: "-200",
    payee: "Grocer March",
    categoryId: groceriesId,
    categoryName: "Groceries",
  }),
  transaction({
    id: 5,
    postedDate: "2026-03-11",
    amount: "50",
    payee: "Grocer refund",
    categoryId: groceriesId,
    categoryName: "Groceries",
  }),
  transaction({
    id: 6,
    postedDate: "2026-03-01",
    amount: "5000",
    payee: "Employer",
    categoryId: incomeId,
    categoryName: "Income",
    categoryKind: "income",
  }),
  transaction({
    id: 7,
    postedDate: "2026-03-20",
    amount: "-1000",
    payee: "Owned transfer",
    categoryId: transferId,
    categoryName: "Transfers",
    ownedTransfer: true,
  }),
  transaction({
    id: 8,
    postedDate: "2026-01-01",
    amount: "-30",
    payee: "Stream Co",
    categoryId: subscriptionsId,
    categoryName: "Subscriptions",
  }),
  transaction({
    id: 9,
    postedDate: "2026-01-31",
    amount: "-30",
    payee: "Stream Co",
    categoryId: subscriptionsId,
    categoryName: "Subscriptions",
  }),
  transaction({
    id: 10,
    postedDate: "2026-03-02",
    amount: "-31",
    payee: "Stream Co",
    categoryId: subscriptionsId,
    categoryName: "Subscriptions",
  }),
] as const;

describe("money analysis", () => {
  test("calculates complete-month spending from signed splits and excludes owned transfers", () => {
    const analysis = analyzeMoney(
      completeRecord(baseTransactions),
      month("2026-03"),
      month("2026-03"),
    );
    const march = analysis.months[0]!;
    const groceries = march.categories.find((category) => category.categoryId === groceriesId)!;

    expect(march.coverage._tag).toBe("Complete");
    if (march.income === null || march.netSpend === null || march.savingsRate === null) {
      throw new Error("a complete month must carry its totals");
    }
    expect(BigDecimal.format(march.income)).toBe("5000");
    expect(BigDecimal.format(march.netSpend)).toBe("181");
    expect(BigDecimal.format(march.savingsRate)).toBe("0.9638");
    expect(BigDecimal.format(groceries.netSpend)).toBe("150");
    if (groceries.trailingThreeMonthAverage === null) {
      throw new Error("three prior complete months must produce a trailing average");
    }
    expect(BigDecimal.format(groceries.trailingThreeMonthAverage)).toBe("200");
    expect(analysis.dataThrough).toBe("2026-03-31");
    expect(analysis.recurringCharges).toHaveLength(1);
    expect(analysis.recurringCharges[0]?.priceChange).toMatchObject({
      previousAmount: money("30"),
      currentAmount: money("31"),
    });
    expect(analysis.suggestions).toHaveLength(1);
  });

  test("returns an unavailable month instead of treating a coverage hole as zero spending", () => {
    const record: MoneyAnalysisRecord = {
      ...completeRecord(baseTransactions),
      coverage: [
        { accountId, start: date("2024-01-01"), end: date("2026-03-14") },
        { accountId, start: date("2026-03-16"), end: date("2026-03-31") },
      ],
    };
    const analysis = analyzeMoney(record, month("2026-03"), month("2026-03"));
    const march = analysis.months[0]!;

    expect(march.coverage).toEqual({
      _tag: "Incomplete",
      gaps: [{ accountId, start: date("2026-03-15"), end: date("2026-03-15") }],
    });
    expect(march.income).toBeNull();
    expect(march.netSpend).toBeNull();
    expect(march.categories).toHaveLength(0);
    expect(analysis.recurringCharges).toHaveLength(0);
    expect(analysis.anomalies).toHaveLength(0);
    expect(analysis.suggestions).toHaveLength(0);
  });

  test("grounds high-value anomaly rules in their full comparison windows", () => {
    const unusual = transaction({
      id: 11,
      postedDate: "2026-03-15",
      amount: "-600",
      payee: "First-time supplier",
      categoryId: groceriesId,
      categoryName: "Groceries",
    });
    const analysis = analyzeMoney(completeRecord([unusual]), month("2026-03"), month("2026-03"));

    expect(analysis.anomalies.map((anomaly) => anomaly._tag)).toEqual([
      "LargeExpense",
      "NewPayee",
      "CategorySpike",
    ]);
  });
});

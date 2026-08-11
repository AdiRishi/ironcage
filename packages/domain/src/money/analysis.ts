import { Schema } from "effect";

import { CalendarDate, CalendarMonth } from "../values/calendar";
import { Money } from "../values/decimal";
import { uuidV7 } from "../values/uuid";
import { BankAccountId } from "./account";
import { CategoryId } from "./categorization";
import { BankTransactionId } from "./import";

export const ReportId = uuidV7("ReportId");
export type ReportId = typeof ReportId.Type;

export const MoneyCoverage = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("Complete") }),
  Schema.Struct({
    _tag: Schema.Literal("Incomplete"),
    gaps: Schema.Array(
      Schema.Struct({ accountId: BankAccountId, start: CalendarDate, end: CalendarDate }),
    ),
  }),
]);
export type MoneyCoverage = typeof MoneyCoverage.Type;

export const MonthlyCategoryAnalysis = Schema.Struct({
  categoryId: CategoryId,
  name: Schema.String,
  netSpend: Money,
  trailingThreeMonthAverage: Schema.NullOr(Money),
  transactionIds: Schema.Array(BankTransactionId),
});
export type MonthlyCategoryAnalysis = typeof MonthlyCategoryAnalysis.Type;

export const MonthlyMoneyAnalysis = Schema.Struct({
  month: CalendarMonth,
  coverage: MoneyCoverage,
  income: Schema.NullOr(Money),
  netSpend: Schema.NullOr(Money),
  savingsRate: Schema.NullOr(Schema.BigDecimalFromString),
  categories: Schema.Array(MonthlyCategoryAnalysis),
});
export type MonthlyMoneyAnalysis = typeof MonthlyMoneyAnalysis.Type;

export const RecurringCharge = Schema.Struct({
  payee: Schema.String,
  cadenceDays: Schema.Int,
  typicalAmount: Money,
  latestAmount: Money,
  estimatedAnnualSpend: Money,
  priceChange: Schema.NullOr(
    Schema.Struct({
      previousAmount: Money,
      currentAmount: Money,
    }),
  ),
  transactionIds: Schema.Array(BankTransactionId),
});
export type RecurringCharge = typeof RecurringCharge.Type;

export const SpendingAnomaly = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("LargeExpense"),
    transactionId: BankTransactionId,
    amount: Money,
  }),
  Schema.Struct({
    _tag: Schema.Literal("NewPayee"),
    transactionId: BankTransactionId,
    payee: Schema.String,
    amount: Money,
  }),
  Schema.Struct({
    _tag: Schema.Literal("CategorySpike"),
    categoryId: CategoryId,
    month: CalendarMonth,
    netSpend: Money,
    trailingAverage: Money,
  }),
]);
export type SpendingAnomaly = typeof SpendingAnomaly.Type;

export const SavingsSuggestion = Schema.Struct({
  title: Schema.String,
  reasoning: Schema.String,
  estimatedAnnualImpact: Money,
  dataThrough: CalendarDate,
  transactionIds: Schema.Array(BankTransactionId),
});
export type SavingsSuggestion = typeof SavingsSuggestion.Type;

export const MoneyAnalysis = Schema.Struct({
  months: Schema.Array(MonthlyMoneyAnalysis),
  recurringCharges: Schema.Array(RecurringCharge),
  anomalies: Schema.Array(SpendingAnomaly),
  suggestions: Schema.Array(SavingsSuggestion),
  dataThrough: Schema.NullOr(CalendarDate),
});
export type MoneyAnalysis = typeof MoneyAnalysis.Type;

export const AccountBalance = Schema.Struct({
  accountId: BankAccountId,
  label: Schema.String,
  kind: Schema.Literals(["ledger", "available"]),
  amount: Money,
  asOfDate: CalendarDate,
});
export type AccountBalance = typeof AccountBalance.Type;

export const MonthlySpendingReport = Schema.Struct({
  id: ReportId,
  month: CalendarMonth,
  generatedAt: Schema.DateTimeUtcFromString,
  readAt: Schema.NullOr(Schema.DateTimeUtcFromString),
  dataThrough: CalendarDate,
  analysis: MonthlyMoneyAnalysis,
  recurringCharges: Schema.Array(RecurringCharge),
  anomalies: Schema.Array(SpendingAnomaly),
  suggestions: Schema.Array(SavingsSuggestion),
  supportingTransactionIds: Schema.Array(BankTransactionId),
  bodyKey: Schema.String,
});
export type MonthlySpendingReport = typeof MonthlySpendingReport.Type;

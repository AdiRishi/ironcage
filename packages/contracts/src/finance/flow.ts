import { Schema } from "effect";

import {
  AccountCoverage,
  ComparisonCoverage,
  ComparisonSelection,
  CountedScope,
  CoverageState,
  DateBasis,
  Period,
  PeriodSelection,
} from "./analysis.ts";
import { CategoryId, CounterpartyId } from "./interpretation.ts";
import { Currency, Instant, Money, YearMonth } from "./values.ts";

export const FlowInput = Schema.Struct({
  period: PeriodSelection,
  comparison: ComparisonSelection,
  basis: DateBasis,
  currency: Currency,
});
export type FlowInput = typeof FlowInput.Type;

const StreamFields = {
  key: Schema.String,
  label: Schema.String,
  amount: Money,
  previous: Money,
  modelAmount: Money,
  // The ledger facts the stream sums. The counted ledger lists the records behind them.
  scope: CountedScope,
};
export const FlowStream = Schema.Union([
  // Spending in one top-level category.
  Schema.Struct({
    kind: Schema.Literal("category"),
    categoryId: CategoryId,
    slug: Schema.NullOr(Schema.String),
    ...StreamFields,
  }),
  Schema.Struct({
    kind: Schema.Literals([
      "uncategorised",
      "income",
      "borrowing",
      "externalIn",
      "externalOut",
      "loanPrincipal",
      "unresolvedIn",
      "unresolvedOut",
    ]),
    ...StreamFields,
  }),
]);
export type FlowStream = typeof FlowStream.Type;

// One of the largest changes against the comparison period, at subcategory level.
export const PeriodChange = Schema.Struct({
  categoryId: Schema.NullOr(CategoryId),
  label: Schema.String,
  parentLabel: Schema.NullOr(Schema.String),
  current: Money,
  previous: Money,
  purchases: Schema.Int,
  previousPurchases: Schema.Int,
  purchasesPart: Schema.NullOr(Money),
  averagePart: Schema.NullOr(Money),
});
export type PeriodChange = typeof PeriodChange.Type;

export const PeriodTotals = Schema.Struct({
  inflow: Money,
  outflow: Money,
  spending: Money,
  income: Money,
  internal: Money,
});
export const PeriodFlow = Schema.Struct({
  period: Period,
  comparison: Period,
  basis: DateBasis,
  currency: Currency,
  calculatedAt: Instant,
  totals: PeriodTotals,
  previousTotals: PeriodTotals,
  inflows: Schema.Array(FlowStream),
  outflows: Schema.Array(FlowStream),
  modelShare: Money,
  changes: Schema.Array(PeriodChange),
  coverage: Schema.Array(AccountCoverage),
  comparisonCoverage: ComparisonCoverage,
});
export type PeriodFlow = typeof PeriodFlow.Type;

export const MonthlyFlowInput = Schema.Struct({ currency: Currency });
export const MonthTotal = Schema.Struct({
  month: YearMonth,
  inflow: Money,
  outflow: Money,
  spending: Money,
  coverage: CoverageState,
});
export const MonthlyFlow = Schema.Array(MonthTotal);

export const SpendingInput = Schema.Struct({
  ...FlowInput.fields,
  categoryId: Schema.NullOr(CategoryId),
});
export type SpendingInput = typeof SpendingInput.Type;
export const SpendingRow = Schema.Struct({
  categoryId: Schema.NullOr(CategoryId),
  slug: Schema.NullOr(Schema.String),
  label: Schema.String,
  current: Money,
  previous: Money,
  purchases: Schema.Int,
  previousPurchases: Schema.Int,
  modelAmount: Money,
  months: Schema.Array(Money),
});
export type SpendingRow = typeof SpendingRow.Type;
export const SpendingCounterparty = Schema.Struct({
  counterpartyId: Schema.NullOr(CounterpartyId),
  label: Schema.String,
  current: Money,
  previous: Money,
  purchases: Schema.Int,
  previousPurchases: Schema.Int,
});
export const SpendingBreakdown = Schema.Struct({
  period: Period,
  comparison: Period,
  basis: DateBasis,
  currency: Currency,
  calculatedAt: Instant,
  path: Schema.Array(
    Schema.Struct({ id: CategoryId, label: Schema.String, slug: Schema.NullOr(Schema.String) }),
  ),
  total: Money,
  previousTotal: Money,
  modelAmount: Money,
  // The twelve months that end with the month containing the period's last day.
  months: Schema.Array(YearMonth),
  rows: Schema.Array(SpendingRow),
  counterparties: Schema.Array(SpendingCounterparty),
  comparisonCoverage: ComparisonCoverage,
});
export type SpendingBreakdown = typeof SpendingBreakdown.Type;

import { Schema, Struct } from "effect";

import {
  AccountCoverage,
  CategoryScope,
  ComparisonCoverage,
  ComparisonSelection,
  CountedScope,
  CoverageState,
  DateBasis,
  Period,
  PeriodSelection,
  Scope,
  ScopeCrumb,
} from "./analysis.ts";
import { InterpretationFilter } from "./interpretation.ts";
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

// Spending in a period against the comparison period. The change splits into a part
// from the number of purchases, a part from the average purchase, and `otherPart`, the
// change in spending that is not a purchase, such as interest or a refund linked to no
// purchase. The three sum to the change. A period with no purchases has no average, and
// when either period has none the first two parts are null. `percentChange` is a whole
// percent, and null unless the comparison amount is positive.
export const ChangeFigures = Schema.Struct({
  current: Money,
  previous: Money,
  change: Money,
  percentChange: Schema.NullOr(Schema.Int),
  purchases: Schema.Int,
  previousPurchases: Schema.Int,
  averagePurchase: Schema.NullOr(Money),
  previousAveragePurchase: Schema.NullOr(Money),
  purchasesPart: Schema.NullOr(Money),
  averagePart: Schema.NullOr(Money),
  otherPart: Money,
});
export type ChangeFigures = typeof ChangeFigures.Type;

// One of the largest changes against the comparison period, in the facts placed on one
// category, which `category` opens.
export const PeriodChange = Schema.Struct({
  category: CategoryScope,
  label: Schema.String,
  parentLabel: Schema.NullOr(Schema.String),
  ...ChangeFigures.fields,
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

// A tag or personal event narrows spending to the allocations that carry it.
export const SpendingInput = Schema.Struct({
  ...FlowInput.fields,
  ...Scope.fields,
  ...Struct.pick(InterpretationFilter.fields, ["tagId", "personalEventId"]),
});
export type SpendingInput = typeof SpendingInput.Type;
// A scope opens its categories one level down. A scope with no categories below it opens
// its counterparties, and one counterparty opens the records the counted ledger lists.
export const SpendingLevel = Schema.Literals(["categories", "counterparties", "transactions"]);
export const SpendingFigures = Schema.Struct({ ...ChangeFigures.fields, modelAmount: Money });
// `share` is the row's whole percent of what the rows with a positive amount add up to,
// and null when its own amount is not positive. `slug` colours the row: its category's,
// or the open category's for a counterparty. `months` follows the breakdown's months.
export const SpendingRow = Schema.Struct({
  label: Schema.String,
  slug: Schema.NullOr(Schema.String),
  opens: Scope,
  share: Schema.NullOr(Schema.Int),
  figures: SpendingFigures,
  months: Schema.Array(Money),
});
export type SpendingRow = typeof SpendingRow.Type;
// The scope's own amount in a month, and whether that month's records are complete.
export const SpendingMonth = Schema.Struct({
  month: YearMonth,
  amount: Money,
  coverage: CoverageState,
});
export const SpendingBreakdown = Schema.Struct({
  period: Period,
  comparison: Period,
  basis: DateBasis,
  currency: Currency,
  calculatedAt: Instant,
  scope: Scope,
  // The open category's slug, which colours the scope and its counterparty rows. Null
  // for all spending and for spending with no category.
  slug: Schema.NullOr(Schema.String),
  // The category and the categories above it, top-level first, then the counterparty.
  // Empty for all spending.
  path: Schema.Array(ScopeCrumb),
  level: SpendingLevel,
  figures: SpendingFigures,
  // The twelve months that end with the month containing the period's last day.
  months: Schema.Array(SpendingMonth),
  coverage: Schema.Array(AccountCoverage),
  comparisonCoverage: ComparisonCoverage,
  // Every part of the scope with spending in either period, so the rows add up to it.
  // Empty at the transactions level.
  rows: Schema.Array(SpendingRow),
});
export type SpendingBreakdown = typeof SpendingBreakdown.Type;

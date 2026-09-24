import { Schema } from "effect";

import { DateBasis, DecimalMoney, OverviewInput, Period, ResultCoverage } from "./analysis.ts";
import { CategoryId, CounterpartyId, TagId, PersonalEventId } from "./interpretation.ts";
import { EventId } from "./interpretation.ts";
import { Posting } from "./postings.ts";
import { CreditLink } from "./relationships.ts";
import { AccountId, CalendarDate, Instant, Money } from "./values.ts";
export const Measure = Schema.Literals([
  "grossCosts",
  "netPersonalCosts",
  "income",
  "surplus",
  "surplusRate",
  "cashBalanceChange",
  "netPrincipalReduction",
  "purchaseCount",
]);
export type Measure = typeof Measure.Type;
export const AnalysisFilters = Schema.Struct({
  categories: Schema.Array(CategoryId),
  counterparties: Schema.Array(CounterpartyId),
  tags: Schema.Array(TagId),
  personalEvents: Schema.Array(PersonalEventId),
});
export const ComparisonSelection = Schema.Union([
  Schema.Struct({ kind: Schema.Literals(["previous", "previousYear"]) }),
  Schema.Struct({ kind: Schema.Literal("fixed"), ...Period.fields }).check(
    Schema.makeFilter(
      (value) => value.start < value.endExclusive || "The comparison must end after it starts.",
    ),
  ),
]);
export const GroupBy = Schema.Literals([
  "category",
  "counterparty",
  "account",
  "tag",
  "personalEvent",
]);
export type GroupBy = typeof GroupBy.Type;
export const AnalysisQuery = Schema.Struct({
  ...OverviewInput.fields,
  measure: Measure,
  comparison: ComparisonSelection,
  filters: AnalysisFilters,
  normalization: Schema.Literals(["total", "dailyAverage"]),
}).check(
  Schema.makeFilter(
    (query) =>
      query.normalization === "total" ||
      ["grossCosts", "netPersonalCosts", "income", "surplus"].includes(query.measure) ||
      "This measure does not support daily averages.",
  ),
  Schema.makeFilter(
    (query) =>
      !["cashBalanceChange", "netPrincipalReduction"].includes(query.measure) ||
      (query.basis === "posted" && Object.values(query.filters).every((ids) => ids.length === 0)) ||
      "Account movements use posted dates and account filters only.",
  ),
);
export type AnalysisQuery = typeof AnalysisQuery.Type;
export const MetricValue = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("money"), amount: Money }),
  Schema.Struct({ kind: Schema.Literal("count"), count: Schema.Int }),
  Schema.Struct({ kind: Schema.Literal("percent"), value: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("dailyAverage"), amount: DecimalMoney }),
  Schema.Struct({ kind: Schema.Literal("unavailable"), reason: Schema.String }),
]);
export type MetricValue = typeof MetricValue.Type;
export const PeriodResult = Schema.Struct({
  period: Period,
  basis: DateBasis,
  total: MetricValue,
  value: MetricValue,
  days: Schema.Int,
  coverage: ResultCoverage,
  purchaseCount: Schema.Int,
  averagePurchase: Schema.NullOr(DecimalMoney),
});
export type PeriodResult = typeof PeriodResult.Type;
export const ComparisonResult = Schema.Struct({
  query: AnalysisQuery,
  accountIds: Schema.Array(AccountId),
  calculatedAt: Instant,
  calculationVersion: Schema.String,
  current: PeriodResult,
  previous: PeriodResult,
  delta: MetricValue,
  relativeChange: Schema.NullOr(Schema.String),
});
export type ComparisonResult = typeof ComparisonResult.Type;
export const Contributor = Schema.Struct({
  key: Schema.String,
  label: Schema.String,
  current: PeriodResult,
  previous: PeriodResult,
  delta: MetricValue,
  relativeChange: Schema.NullOr(Schema.String),
  incomplete: Schema.Boolean,
  frequencyContribution: Schema.NullOr(Money),
  averageCostContribution: Schema.NullOr(Money),
});
export type Contributor = typeof Contributor.Type;
export const ContributorsInput = Schema.Struct({ query: AnalysisQuery, groupBy: GroupBy }).check(
  Schema.makeFilter(
    (input) =>
      !["cashBalanceChange", "netPrincipalReduction"].includes(input.query.measure) ||
      input.groupBy === "account" ||
      "Account movements can only be grouped by account.",
  ),
);
export const ContributorsResult = Schema.Struct({
  comparison: ComparisonResult,
  groupBy: GroupBy,
  rows: Schema.Array(Contributor),
  remainder: Schema.NullOr(MetricValue),
  overlap: Schema.Boolean,
});
export type ContributorsResult = typeof ContributorsResult.Type;

export const AnalysisRowCursor = Schema.Struct({
  on: CalendarDate,
  id: Schema.String.check(Schema.isUUID()),
  period: Schema.Literals(["current", "previous"]),
});
export const AnalysisRowsInput = Schema.Struct({
  query: AnalysisQuery,
  groupBy: GroupBy,
  groupKey: Schema.Union([
    Schema.Literals(["unassigned", "remainder"]),
    Schema.String.check(Schema.isUUID()),
  ]),
  cursor: Schema.optionalKey(AnalysisRowCursor),
});
export type AnalysisRowsInput = typeof AnalysisRowsInput.Type;
export const AnalysisRow = Schema.Struct({
  ...AnalysisRowCursor.fields,
  eventId: Schema.NullOr(EventId),
  posting: Posting,
  counterparts: Schema.Array(Posting),
  contribution: MetricValue,
  credits: Schema.Array(CreditLink),
});
export type AnalysisRow = typeof AnalysisRow.Type;
export const AnalysisRowsResult = Schema.Struct({
  headline: ComparisonResult,
  groupKey: Schema.String,
  label: Schema.String,
  rows: Schema.Array(AnalysisRow),
  nextCursor: Schema.NullOr(AnalysisRowCursor),
});
export type AnalysisRowsResult = typeof AnalysisRowsResult.Type;

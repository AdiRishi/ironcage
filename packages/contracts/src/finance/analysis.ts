import { Schema } from "effect";

import { Account } from "./accounts.ts";
import { CategoryId, CounterpartyId } from "./interpretation.ts";
import { CalendarDate, Instant, YearMonth } from "./values.ts";

export const Period = Schema.Struct({ start: CalendarDate, endExclusive: CalendarDate }).check(
  Schema.makeFilter(
    (period) => period.start < period.endExclusive || "The period must end after it starts.",
  ),
);
export type Period = typeof Period.Type;
const Count = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 3660 }));
export const PeriodSelection = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("fixed"), ...Period.fields }).check(
    Schema.makeFilter(
      (period) => period.start < period.endExclusive || "The period must end after it starts.",
    ),
  ),
  // Whole calendar months, the first through the last. The month containing today
  // ends after today. A period ending in December 9999 would end in year 10000.
  Schema.Struct({ kind: Schema.Literal("months"), from: YearMonth, to: YearMonth }).check(
    Schema.makeFilter(
      (months) => months.from <= months.to || "The first month must not come after the last.",
    ),
    Schema.makeFilter(
      (months) => months.to < "9999-12" || "Choose months that end before December 9999.",
    ),
  ),
  Schema.Struct({ kind: Schema.Literal("rolling"), days: Count }),
  Schema.Struct({
    kind: Schema.Literal("calendar"),
    unit: Schema.Literals(["week", "month", "quarter", "year"]),
    count: Count,
    offset: Schema.Int.check(Schema.isBetween({ minimum: -120, maximum: 0 })),
    alignment: Schema.Literals(["elapsed", "full"]),
  }),
]);
export type PeriodSelection = typeof PeriodSelection.Type;
export const DateBasis = Schema.Literals(["posted", "spending"]);
export const ComparisonSelection = Schema.Union([
  Schema.Struct({ kind: Schema.Literals(["previous", "previousYear"]) }),
  Schema.Struct({ kind: Schema.Literal("fixed"), ...Period.fields }).check(
    Schema.makeFilter(
      (value) => value.start < value.endExclusive || "The comparison must end after it starts.",
    ),
  ),
]);
export const AccountCoverage = Schema.Struct({
  account: Schema.Struct({
    id: Account.fields.id,
    kind: Account.fields.kind,
    label: Account.fields.label,
    currency: Account.fields.currency,
  }),
  observed: Schema.Array(Period),
  reconciled: Schema.Array(Period),
  missing: Schema.Array(Period),
  latestImportAt: Schema.NullOr(Instant),
});
export type AccountCoverage = typeof AccountCoverage.Type;
export const CoverageState = Schema.Literals(["complete", "partial", "missing"]);
// Whether the accounts recorded in a period also have records in its comparison
// period, and the dates each one lacks there.
export const ComparisonCoverage = Schema.Struct({
  state: CoverageState,
  gaps: Schema.Array(
    Schema.Struct({ account: AccountCoverage.fields.account, missing: Schema.Array(Period) }),
  ),
});
export type ComparisonCoverage = typeof ComparisonCoverage.Type;

// What one ledger fact contributes to. `internal` moves money between ledger accounts
// and counts toward no measure.
export const FactMeasure = Schema.Literals([
  "spending",
  "income",
  "internal",
  "externalOut",
  "externalIn",
  "loanRepayment",
  "borrowing",
  "unresolvedOut",
  "unresolvedIn",
]);
export type FactMeasure = typeof FactMeasure.Type;
// A number the flow draws from ledger facts, whose records the counted ledger lists.
export const LedgerMeasure = Schema.Literals([
  "spending",
  "income",
  "borrowing",
  "externalIn",
  "externalOut",
  "loanPrincipal",
  "unresolvedIn",
  "unresolvedOut",
]);
export type LedgerMeasure = typeof LedgerMeasure.Type;
// Whether a part of a measure adds to it or is taken off it.
export const PartSign = Schema.Literals(["add", "less"]);
export type PartSign = typeof PartSign.Type;
// A category with everything below it, only what sits on the category itself, or what
// has no category yet.
export const CategoryScope = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("all") }),
  Schema.Struct({ kind: Schema.Literal("category"), id: CategoryId }),
  Schema.Struct({ kind: Schema.Literal("unspecified"), id: CategoryId }),
  Schema.Struct({ kind: Schema.Literal("uncategorised") }),
]).pipe(Schema.toTaggedUnion("kind"));
export type CategoryScope = typeof CategoryScope.Type;
export const CounterpartyScope = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("all") }),
  Schema.Struct({ kind: Schema.Literal("counterparty"), id: CounterpartyId }),
  Schema.Struct({ kind: Schema.Literal("unidentified") }),
]).pipe(Schema.toTaggedUnion("kind"));
export type CounterpartyScope = typeof CounterpartyScope.Type;
// The ledger facts behind one number: a measure narrowed to categories and a
// counterparty. A period, a date basis, and a currency place it in time.
export const CountedScope = Schema.Struct({
  measure: LedgerMeasure,
  category: CategoryScope,
  counterparty: CounterpartyScope,
});
export type CountedScope = typeof CountedScope.Type;

// Events whose ledger facts an older derivation built, and whether a background
// rebuild is working through them.
export const FactsStatus = Schema.Struct({ outdated: Schema.Int, rebuilding: Schema.Boolean });
export const FactsRebuildInput = Schema.Struct({ rebuildId: Schema.String.check(Schema.isUUID()) });

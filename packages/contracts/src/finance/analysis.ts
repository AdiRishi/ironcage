import { Schema } from "effect";

import { Account } from "./accounts.ts";
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

// Events whose ledger facts an older derivation built, and whether a background
// rebuild is working through them.
export const FactsStatus = Schema.Struct({ outdated: Schema.Int, rebuilding: Schema.Boolean });
export const FactsRebuildInput = Schema.Struct({ rebuildId: Schema.String.check(Schema.isUUID()) });

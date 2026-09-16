import { Schema } from "effect";

import { Account } from "./accounts.ts";
import { AccountId, CalendarDate, Currency, Instant, Money } from "./values.ts";

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
export const OverviewInput = Schema.Struct({
  period: PeriodSelection,
  basis: DateBasis,
  currency: Currency,
  accounts: Schema.Array(AccountId),
});
export type OverviewInput = typeof OverviewInput.Type;
export const DecimalMoney = Schema.Struct({ currency: Currency, value: Schema.String });
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
export const ResultCoverage = Schema.Struct({
  accounts: Schema.Array(AccountCoverage),
  unresolvedCount: Schema.Int,
  unresolvedAmount: Money,
  unlinkedCredits: Money,
});
export const LoanMeasure = Schema.Struct({
  accountId: AccountId,
  label: Schema.String,
  repayments: Money,
  financingCosts: Money,
  netPrincipalReduction: Schema.NullOr(Money),
});
export const OverviewResult = Schema.Struct({
  period: Period,
  basis: DateBasis,
  currency: Currency,
  accountIds: Schema.Array(AccountId),
  calculatedAt: Instant,
  calculationVersion: Schema.String,
  coverage: ResultCoverage,
  grossCosts: Money,
  netPersonalCosts: Money,
  income: Money,
  surplus: Money,
  surplusRate: Schema.NullOr(Schema.String),
  cashBalanceChange: Schema.NullOr(Money),
  purchaseCount: Schema.Int,
  loans: Schema.Array(LoanMeasure),
});
export type OverviewResult = typeof OverviewResult.Type;

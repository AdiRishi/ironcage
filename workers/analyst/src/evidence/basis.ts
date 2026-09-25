import type { Basis, Limit } from "@repo/contracts/analyst";
import type { AccountCoverage, ComparisonCoverage, Instant, Period } from "@repo/contracts/finance";
import { mergePeriods, missingPeriods, periodsWithin } from "@repo/finance";
import { Array as Arr } from "effect";

export type AccountLabel = AccountCoverage["account"];

// One read's period, its comparison, and the days each account recorded, as the API
// reported them. An account's days may run past the period when one read of the API
// covers several periods, such as the months of a series.
export type CoverageRead = {
  readonly period: Period;
  readonly comparison: Period | null;
  readonly basis: Basis["basis"];
  readonly calculatedAt: Instant;
  readonly accounts: ReadonlyArray<AccountCoverage>;
  readonly comparisonGaps: ComparisonCoverage["gaps"];
};

// Each period read against a comparison once, then the other days read, joined into
// spans, that none of those names.
function periodsOf(reads: ReadonlyArray<CoverageRead>): Basis["periods"] {
  const compared = Arr.dedupe(
    reads.flatMap(({ period, comparison }) => (comparison ? [{ period, comparison }] : [])),
  );
  const named = mergePeriods(compared.flatMap(({ period, comparison }) => [period, comparison]));
  const rest = mergePeriods(
    reads.flatMap(({ period, comparison }) => (comparison ? [] : missingPeriods(period, named))),
  );
  return [...compared, ...rest.map((period) => ({ period, comparison: null }))];
}

// The periods of `reads`, and the days of them each account in `currency` has no records
// for, the days its comparisons lack included, and has reconciled statements for. Null
// when there are no reads.
export function basisOf(
  currency: string,
  reads: ReadonlyArray<CoverageRead>,
  accounts: ReadonlyArray<AccountLabel>,
): Basis | null {
  const [first] = reads;
  if (!first) return null;
  const days = reads.flatMap((read) => {
    const within = (intervals: ReadonlyArray<Period>) =>
      [read.period, read.comparison].flatMap((period) =>
        period ? periodsWithin(period, intervals) : [],
      );
    return [
      ...read.accounts.map(({ account, missing, reconciled }) => ({
        account,
        missing: within(missing),
        reconciled: within(reconciled),
      })),
      ...read.comparisonGaps.map((gap) => ({ ...gap, reconciled: [] })),
    ];
  });
  return {
    periods: periodsOf(reads),
    basis: first.basis,
    currency,
    accounts: Object.values(Arr.groupBy(days, (item) => item.account.id)).map((items) => ({
      account: items[0].account,
      missing: mergePeriods(items.flatMap((item) => item.missing)),
      reconciled: mergePeriods(items.flatMap((item) => item.reconciled)),
    })),
    otherCurrencyAccounts: accounts.filter((account) => account.currency !== currency),
    calculatedAt: first.calculatedAt,
  };
}

export function missingRecords(basis: Basis): ReadonlyArray<Limit> {
  return basis.accounts.flatMap(({ account, missing }) =>
    missing.map((period) => ({ kind: "missingRecords", account, period }) satisfies Limit),
  );
}

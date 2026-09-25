import type {
  Account,
  AccountCoverage,
  CalendarDate,
  ComparisonCoverage,
  CoverageState,
  Period,
  YearMonth,
} from "@repo/contracts/finance";

import { addDays } from "../dates.ts";
import { missingPeriods, mergePeriods, monthsPeriod, overlaps } from "./periods.ts";

// The accounts in one currency, what each of their source files covers, and when each
// was last imported.
export type CoverageSnapshot = {
  accounts: readonly Account[];
  sources: readonly {
    accountId: Account["id"];
    observedStart: CalendarDate | null;
    observedEnd: CalendarDate | null;
    openingOn: CalendarDate | null;
    closingOn: CalendarDate | null;
    reconciled: boolean;
  }[];
  imports: readonly { accountId: Account["id"]; at: string }[];
};

export function accountCoverage(snapshot: CoverageSnapshot, period: Period): AccountCoverage[] {
  return snapshot.accounts.map((account) => {
    const sources = snapshot.sources.filter((source) => source.accountId === account.id);
    const observed = sources.flatMap((source) =>
      source.observedStart && source.observedEnd
        ? [{ start: source.observedStart, endExclusive: addDays(source.observedEnd, 1) }]
        : [],
    );
    const reconciled = sources.flatMap((source) =>
      source.reconciled && source.openingOn && source.closingOn
        ? [{ start: source.openingOn, endExclusive: addDays(source.closingOn, 1) }]
        : [],
    );
    return {
      account: {
        id: account.id,
        kind: account.kind,
        label: account.label,
        currency: account.currency,
      },
      observed: mergePeriods(observed),
      reconciled: mergePeriods(reconciled),
      missing: missingPeriods(period, reconciled),
      latestImportAt: snapshot.imports.find((item) => item.accountId === account.id)?.at ?? null,
    };
  });
}

// An account covers the days its files run across and the days its reconciled
// statements span, because a reconciled statement proves that its days without
// transactions had none. Only accounts that cover part of the period can make its
// comparison read as zero, so only they have gaps. A comparison is missing when no
// account covers any of it.
export function comparisonCoverage(
  coverage: readonly AccountCoverage[],
  period: Period,
  comparison: Period,
): ComparisonCoverage {
  const accounts = coverage.map((item) => ({
    account: item.account,
    covered: mergePeriods([...item.observed, ...item.reconciled]),
  }));
  const gaps = accounts
    .filter((item) => item.covered.some((interval) => overlaps(interval, period)))
    .flatMap((item) => {
      const missing = missingPeriods(comparison, item.covered);
      return missing.length > 0 ? [{ account: item.account, missing }] : [];
    });
  return {
    state: !accounts.some((item) => item.covered.some((interval) => overlaps(interval, comparison)))
      ? "missing"
      : gaps.length > 0
        ? "partial"
        : "complete",
    gaps,
  };
}

// An account counts for a month when its records span it at all. The month is complete
// when every such account has reconciled statements across all of it, partial when one
// of them has records in it, and missing otherwise, as every month before the first
// record is.
export function monthCoverage(snapshot: CoverageSnapshot, month: YearMonth): CoverageState {
  const period = monthsPeriod(month);
  const counted = accountCoverage(snapshot, period).filter(({ observed }) => {
    const [first] = observed;
    const last = observed.at(-1);
    return (
      first && last && overlaps({ start: first.start, endExclusive: last.endExclusive }, period)
    );
  });
  if (counted.length > 0 && counted.every((item) => item.missing.length === 0)) return "complete";
  return counted.some((item) => item.observed.some((interval) => overlaps(interval, period)))
    ? "partial"
    : "missing";
}

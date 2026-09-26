import type {
  Account,
  AccountCoverage,
  CalendarDate,
  ComparisonCoverage,
  CoverageState,
  Period,
  YearMonth,
} from "@repo/contracts/finance";

import { addDays, yearMonthOf } from "../dates.ts";
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

// The days an account has records for: between the first and last record of one of its
// files, or inside a reconciled statement, because a reconciled statement proves that its
// days without transactions had none.
const coveredDays = (item: AccountCoverage) => mergePeriods([...item.observed, ...item.reconciled]);

// The days of a period each account has no records for. An account is expected to have
// records for every day of the months from its first record through the month of the
// latest record of any account, so a card whose latest statement is not in yet is named
// beside a month the everyday account covers. Nothing marks an account closed, so an
// account whose records stopped is named for every month after them too.
export function periodGaps(
  coverage: readonly AccountCoverage[],
  period: Period,
): ComparisonCoverage["gaps"] {
  const accounts = coverage.map((item) => ({ account: item.account, covered: coveredDays(item) }));
  const latest = accounts
    .flatMap(({ covered }) => covered.map((interval) => interval.endExclusive))
    .toSorted()
    .at(-1);
  return accounts.flatMap(({ account, covered }) => {
    const [first] = covered;
    if (!first || !latest) return [];
    const expected = monthsPeriod(yearMonthOf(first.start), yearMonthOf(addDays(latest, -1)));
    if (!overlaps(expected, period)) return [];
    const missing = missingPeriods(
      {
        start: expected.start > period.start ? expected.start : period.start,
        endExclusive:
          expected.endExclusive < period.endExclusive ? expected.endExclusive : period.endExclusive,
      },
      covered,
    );
    return missing.length > 0 ? [{ account, missing }] : [];
  });
}

// Only accounts that cover part of the period can make its comparison read as zero, so
// only they have gaps. A comparison is missing when no account covers any of it.
export function comparisonCoverage(
  coverage: readonly AccountCoverage[],
  period: Period,
  comparison: Period,
): ComparisonCoverage {
  const accounts = coverage.map((item) => ({ account: item.account, covered: coveredDays(item) }));
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

// Whether any account has records for a day of the period.
export function hasRecords(coverage: readonly AccountCoverage[], period: Period) {
  return coverage.some((item) => coveredDays(item).some((interval) => overlaps(interval, period)));
}

// A month is missing when no account has records in it, as every month before the first
// record is, partial when `periodGaps` names days of it, and complete otherwise, so the
// strip and the note beside a month's figures agree.
export function monthCoverage(snapshot: CoverageSnapshot, month: YearMonth): CoverageState {
  const period = monthsPeriod(month);
  const coverage = accountCoverage(snapshot, period);
  if (!hasRecords(coverage, period)) return "missing";
  return periodGaps(coverage, period).length > 0 ? "partial" : "complete";
}

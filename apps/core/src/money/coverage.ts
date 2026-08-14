import { addDays, monthOf, toEpochDay, type CalendarDate } from "@ironcage/domain";

/**
 * An inclusive covered span. Overlapping complete segments merge in this view
 * while remaining separate source records; gaps are computed from the union
 * rather than mutated as independent truth.
 */
export interface CoveredSpan {
  readonly start: CalendarDate;
  readonly end: CalendarDate;
}

export const mergeSpans = (spans: readonly CoveredSpan[]): readonly CoveredSpan[] => {
  const sorted = [...spans].sort((a, b) => toEpochDay(a.start) - toEpochDay(b.start));
  const merged: { start: CalendarDate; end: CalendarDate }[] = [];

  for (const span of sorted) {
    const last = merged[merged.length - 1];
    if (last !== undefined && span.start <= addDays(last.end, 1)) {
      if (span.end > last.end) last.end = span.end;
    } else {
      merged.push({ ...span });
    }
  }

  return merged;
};

/** The uncovered stretches of `within`, given an already-merged union. */
export const coverageGaps = (
  merged: readonly CoveredSpan[],
  within: CoveredSpan,
): readonly CoveredSpan[] => {
  const gaps: CoveredSpan[] = [];
  let cursor = within.start;

  for (const span of merged) {
    if (span.end < cursor) continue;
    if (span.start > within.end) break;
    if (span.start > cursor) {
      gaps.push({ start: cursor, end: addDays(span.start, -1) });
    }
    const next = addDays(span.end, 1);
    if (next > within.end) return gaps;
    cursor = next > cursor ? next : cursor;
  }

  if (cursor <= within.end) gaps.push({ start: cursor, end: within.end });
  return gaps;
};

export interface AccountLife {
  readonly openedOn: CalendarDate | null;
  readonly closedOn: CalendarDate | null;
}

const monthSpan = (month: string): CoveredSpan => {
  const start = `${month}-01` as CalendarDate;
  const next = new Date(`${start}T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return { start, end: addDays(next.toISOString().slice(0, 10) as CalendarDate, -1) };
};

/**
 * A month is complete for an account when every calendar day the account was
 * alive in that month is covered. An account is not required outside its
 * effective dates — but a month entirely outside its life holds no claim
 * either way and reports complete.
 */
export const monthCompleteForAccount = (
  merged: readonly CoveredSpan[],
  month: string,
  life: AccountLife,
): boolean => {
  const span = monthSpan(month);
  const start = life.openedOn !== null && life.openedOn > span.start ? life.openedOn : span.start;
  const end = life.closedOn !== null && life.closedOn < span.end ? life.closedOn : span.end;
  if (start > end) return true;
  return coverageGaps(merged, { start, end }).length === 0;
};

export interface RequiredAccountCoverage {
  readonly merged: readonly CoveredSpan[];
  readonly life: AccountLife;
}

/** The Money months every required account covers in full. */
export const completeMonths = (
  accounts: readonly RequiredAccountCoverage[],
  months: readonly string[],
): ReadonlySet<string> =>
  new Set(
    months.filter((month) =>
      accounts.every((account) => monthCompleteForAccount(account.merged, month, account.life)),
    ),
  );

/** Every `YYYY-MM` from the first to the last date, inclusive. */
export const monthsBetween = (from: CalendarDate, to: CalendarDate): readonly string[] => {
  const months: string[] = [];
  const cursor = new Date(`${from.slice(0, 7)}-01T00:00:00Z`);
  const stop = monthOf(to);

  while (true) {
    const month = cursor.toISOString().slice(0, 7);
    months.push(month);
    if (month >= stop) break;
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return months;
};

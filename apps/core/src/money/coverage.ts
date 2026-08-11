import { CalendarDate, CalendarMonth, type BankAccount, type CoverageGap } from "@ironcage/domain";
import { DateTime, Schema } from "effect";

export interface CoverageSegment {
  readonly accountId: BankAccount["id"];
  readonly start: CalendarDate;
  readonly end: CalendarDate;
}

export interface DateInterval {
  readonly start: CalendarDate;
  readonly end: CalendarDate;
}

const decodeCalendarDate = Schema.decodeUnknownSync(CalendarDate);
const decodeCalendarMonth = Schema.decodeUnknownSync(CalendarMonth);

export const shiftCalendarDate = (date: CalendarDate, days: number) =>
  decodeCalendarDate(
    DateTime.formatIsoDateUtc(DateTime.add(DateTime.makeUnsafe(`${date}T00:00:00Z`), { days })),
  );

export const calendarMonthForDate = (date: CalendarDate) => decodeCalendarMonth(date.slice(0, 7));

export const shiftCalendarMonth = (month: CalendarMonth, months: number) =>
  decodeCalendarMonth(
    DateTime.formatIsoDateUtc(
      DateTime.add(DateTime.makeUnsafe(`${month}-01T00:00:00Z`), { months }),
    ).slice(0, 7),
  );

export const calendarMonthWindow = (month: CalendarMonth): DateInterval => {
  const start = decodeCalendarDate(`${month}-01`);
  const next = DateTime.add(DateTime.makeUnsafe(`${start}T00:00:00Z`), { months: 1 });
  return { start, end: shiftCalendarDate(decodeCalendarDate(DateTime.formatIsoDateUtc(next)), -1) };
};

export const calendarMonthsBetween = (start: CalendarMonth, end: CalendarMonth) => {
  const months: CalendarMonth[] = [];
  for (let current = start; current <= end; current = shiftCalendarMonth(current, 1)) {
    months.push(current);
  }
  return months;
};

export const intersectIntervals = (
  left: DateInterval,
  right: DateInterval,
): DateInterval | null => {
  const start = left.start > right.start ? left.start : right.start;
  const end = left.end < right.end ? left.end : right.end;

  return start <= end ? { start, end } : null;
};

export const mergeIntervals = (intervals: readonly DateInterval[]): readonly DateInterval[] => {
  const sorted = [...intervals].sort(
    (left, right) => left.start.localeCompare(right.start) || left.end.localeCompare(right.end),
  );
  const merged: DateInterval[] = [];

  for (const interval of sorted) {
    const previous = merged.at(-1);

    if (previous === undefined || interval.start > shiftCalendarDate(previous.end, 1)) {
      merged.push(interval);
      continue;
    }

    if (interval.end > previous.end) {
      merged[merged.length - 1] = { start: previous.start, end: interval.end };
    }
  }

  return merged;
};

export const uncoveredIntervals = (
  required: DateInterval,
  covered: readonly DateInterval[],
): readonly DateInterval[] => {
  const relevant = mergeIntervals(
    covered.flatMap((interval) => {
      const overlap = intersectIntervals(required, interval);
      return overlap === null ? [] : [overlap];
    }),
  );
  const gaps: DateInterval[] = [];
  let cursor = required.start;

  for (const interval of relevant) {
    if (cursor < interval.start) {
      gaps.push({ start: cursor, end: shiftCalendarDate(interval.start, -1) });
    }
    cursor = shiftCalendarDate(interval.end, 1);
  }

  if (cursor <= required.end) gaps.push({ start: cursor, end: required.end });

  return gaps;
};

export const coverageGaps = (
  accounts: readonly BankAccount[],
  segments: readonly CoverageSegment[],
  window: DateInterval,
): readonly CoverageGap[] =>
  accounts.flatMap((account) => {
    if (!account.required) return [];

    const accountWindow = intersectIntervals(window, {
      start: account.effectiveFrom,
      end: account.effectiveTo ?? window.end,
    });

    if (accountWindow === null) return [];

    return uncoveredIntervals(
      accountWindow,
      segments
        .filter((segment) => segment.accountId === account.id)
        .map(({ start, end }) => ({ start, end })),
    ).map(({ start, end }) => ({ accountId: account.id, start, end }));
  });

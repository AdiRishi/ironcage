import {
  CalendarDate,
  type ComparisonSelection,
  FinanceError,
  type MonthsSelection,
  Period,
  type PeriodSelection,
  type YearMonth,
} from "@repo/contracts/finance";
import { DateTime, Result, Schema } from "effect";

import { addDays, monthCount, shiftYearMonth, yearMonthOf, yearMonthStart } from "../dates.ts";

const monthsPerUnit = { month: 1, quarter: 3, year: 12 };

export function daysInPeriod(period: Period) {
  return (
    (DateTime.toEpochMillis(DateTime.makeUnsafe(period.endExclusive)) -
      DateTime.toEpochMillis(DateTime.makeUnsafe(period.start))) /
    86400000
  );
}
function calendarShift(
  on: DateTime.Utc,
  unit: "week" | "month" | "quarter" | "year",
  count: number,
) {
  return DateTime.add(
    on,
    unit === "week" ? { weeks: count } : { months: count * monthsPerUnit[unit] },
  );
}
// How far a selection reaches from its start once whole: calendar months for
// selections made of months, days for weeks, rolling days, and fixed dates.
function wholeSpan(selection: PeriodSelection, current: Period) {
  switch (selection.kind) {
    case "months":
      return { unit: "months", count: monthCount(selection.from, selection.to) } as const;
    case "calendar":
      return selection.unit === "week"
        ? ({ unit: "days", count: selection.count * 7 } as const)
        : ({ unit: "months", count: selection.count * monthsPerUnit[selection.unit] } as const);
    case "rolling":
    case "fixed":
      return { unit: "days", count: daysInPeriod(current) } as const;
  }
}
function resolvedPeriod(start: DateTime.Utc, endExclusive: DateTime.Utc) {
  return Schema.decodeResult(Period)({
    start: DateTime.formatIsoDateUtc(start),
    endExclusive: DateTime.formatIsoDateUtc(endExclusive),
  }).pipe(
    Result.mapError(
      () =>
        new FinanceError({
          kind: "invalid",
          message: "Choose a period and comparison whose dates fall between years 0001 and 9999.",
        }),
    ),
  );
}

// The whole months `from` through `to`.
export function monthsPeriod(from: YearMonth, to: YearMonth = from): Period {
  return { start: yearMonthStart(from), endExclusive: yearMonthStart(shiftYearMonth(to, 1)) };
}
// The months a period spans when it runs from the first day of a month to the last day
// of one, and null when it starts or ends within a month.
export function wholeMonths(period: Period): MonthsSelection | null {
  const from = yearMonthOf(period.start);
  const to = yearMonthOf(addDays(period.endExclusive, -1));
  const whole = monthsPeriod(from, to);
  return whole.start === period.start && whole.endExclusive === period.endExclusive
    ? { kind: "months", from, to }
    : null;
}
// The twelve whole months that end with the month containing the period's last day.
export function trailingYear(period: Period): Result.Result<Period, FinanceError> {
  const lastMonth = DateTime.startOf(
    DateTime.makeUnsafe(addDays(period.endExclusive, -1)),
    "month",
  );
  return resolvedPeriod(
    DateTime.add(lastMonth, { months: -11 }),
    DateTime.add(lastMonth, { months: 1 }),
  );
}

export function resolvePeriod(
  selection: PeriodSelection,
  today: CalendarDate,
): Result.Result<Period, FinanceError> {
  if (selection.kind === "fixed")
    return Result.succeed({ start: selection.start, endExclusive: selection.endExclusive });
  if (selection.kind === "months") {
    const whole = monthsPeriod(selection.from, selection.to);
    return Result.succeed(
      whole.start <= today && today < whole.endExclusive
        ? { start: whole.start, endExclusive: addDays(today, 1) }
        : whole,
    );
  }
  const date = DateTime.makeUnsafe(today);
  const tomorrow = DateTime.add(date, { days: 1 });
  if (selection.kind === "rolling")
    return resolvedPeriod(DateTime.add(date, { days: 1 - selection.days }), tomorrow);
  const start =
    selection.unit === "quarter"
      ? DateTime.add(DateTime.startOf(date, "month"), {
          months: -((DateTime.toPartsUtc(date).month - 1) % 3),
        })
      : DateTime.startOf(date, selection.unit, { weekStartsOn: 1 });
  const endExclusive = calendarShift(start, selection.unit, selection.offset + 1);
  return resolvedPeriod(
    calendarShift(start, selection.unit, selection.offset + 1 - selection.count),
    selection.offset === 0 && selection.alignment === "elapsed" ? tomorrow : endExclusive,
  );
}
export function missingPeriods(period: Period, intervals: readonly Period[]): Period[] {
  let cursor = period.start;
  const missing: Period[] = [];
  for (const interval of [...intervals].sort((a, b) => a.start.localeCompare(b.start))) {
    if (interval.endExclusive <= cursor || interval.start >= period.endExclusive) continue;
    if (interval.start > cursor) missing.push({ start: cursor, endExclusive: interval.start });
    cursor = interval.endExclusive > cursor ? interval.endExclusive : cursor;
    if (cursor >= period.endExclusive) return missing;
  }
  if (cursor < period.endExclusive)
    missing.push({ start: cursor, endExclusive: period.endExclusive });
  return missing;
}
// The parts of `intervals` that fall inside `period`.
export function periodsWithin(period: Period, intervals: readonly Period[]): Period[] {
  return intervals.flatMap((interval) =>
    overlaps(interval, period)
      ? [
          {
            start: interval.start > period.start ? interval.start : period.start,
            endExclusive:
              interval.endExclusive < period.endExclusive
                ? interval.endExclusive
                : period.endExclusive,
          },
        ]
      : [],
  );
}
export function mergePeriods(intervals: readonly Period[]): Period[] {
  const merged: Period[] = [];
  for (const interval of [...intervals].sort((a, b) => a.start.localeCompare(b.start))) {
    const last = merged.at(-1);
    if (last && interval.start <= last.endExclusive) {
      if (interval.endExclusive > last.endExclusive)
        merged[merged.length - 1] = { start: last.start, endExclusive: interval.endExclusive };
    } else merged.push(interval);
  }
  return merged;
}
export function overlaps(a: Period, b: Period) {
  return a.start < b.endExclusive && b.start < a.endExclusive;
}

// The comparison moves the period back by its own span, or by twelve months for the
// year before. A whole period made of months compares with whole months. Any other
// period ends one day after its last day moved back, and month arithmetic clamps that
// day to the end of a shorter month, so a comparison never runs into the next month.
export function comparisonPeriod(
  selection: PeriodSelection,
  comparison: typeof ComparisonSelection.Type,
  current: Period,
): Result.Result<Period, FinanceError> {
  if (comparison.kind === "fixed")
    return Result.succeed({ start: comparison.start, endExclusive: comparison.endExclusive });
  const span = wholeSpan(selection, current);
  const step =
    comparison.kind === "previousYear"
      ? { months: -12 }
      : span.unit === "months"
        ? { months: -span.count }
        : { days: -span.count };
  const start = DateTime.makeUnsafe(current.start);
  const end = DateTime.makeUnsafe(current.endExclusive);
  const whole =
    span.unit === "months" &&
    !DateTime.isLessThan(end, DateTime.add(start, { months: span.count }));
  return resolvedPeriod(
    DateTime.add(start, step),
    whole
      ? DateTime.add(end, step)
      : DateTime.add(DateTime.add(DateTime.add(end, { days: -1 }), step), { days: 1 }),
  );
}

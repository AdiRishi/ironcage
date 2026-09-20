import { CalendarDate, FinanceError, Period, type PeriodSelection } from "@repo/contracts/finance";
import { DateTime, Result, Schema } from "effect";

export function addDays(on: CalendarDate, days: number) {
  return CalendarDate.make(
    DateTime.formatIsoDateUtc(DateTime.add(DateTime.makeUnsafe(on), { days })),
  );
}
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
    unit === "week"
      ? { weeks: count }
      : { months: count * (unit === "quarter" ? 3 : unit === "year" ? 12 : 1) },
  );
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
export function resolvePeriod(
  selection: PeriodSelection,
  today: CalendarDate,
): Result.Result<Period, FinanceError> {
  if (selection.kind === "fixed")
    return Result.succeed({ start: selection.start, endExclusive: selection.endExclusive });
  const date = DateTime.makeUnsafe(today);
  if (selection.kind === "rolling")
    return resolvedPeriod(
      DateTime.add(date, { days: 1 - selection.days }),
      DateTime.add(date, { days: 1 }),
    );
  const start =
    selection.unit === "quarter"
      ? DateTime.add(DateTime.startOf(date, "month"), {
          months: -((DateTime.toPartsUtc(date).month - 1) % 3),
        })
      : DateTime.startOf(date, selection.unit, { weekStartsOn: 1 });
  const endExclusive = calendarShift(start, selection.unit, selection.offset + 1);
  return resolvedPeriod(
    calendarShift(start, selection.unit, selection.offset + 1 - selection.count),
    selection.offset === 0 && selection.alignment === "elapsed"
      ? DateTime.add(date, { days: 1 })
      : endExclusive,
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
export function inPeriod(on: CalendarDate, period: Period) {
  return on >= period.start && on < period.endExclusive;
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

export function comparisonPeriod(
  selection: PeriodSelection,
  comparison: import("@repo/contracts/finance").AnalysisQuery["comparison"],
  current: Period,
): Result.Result<Period, FinanceError> {
  if (comparison.kind === "fixed")
    return Result.succeed({ start: comparison.start, endExclusive: comparison.endExclusive });
  const currentStart = DateTime.makeUnsafe(current.start);
  if (comparison.kind === "previousYear") {
    const start = calendarShift(currentStart, "year", -1);
    const endExclusive = calendarShift(DateTime.makeUnsafe(current.endExclusive), "year", -1);
    return resolvedPeriod(start, DateTime.max(endExclusive, DateTime.add(start, { days: 1 })));
  }
  if (selection.kind !== "calendar") {
    const days = daysInPeriod(current);
    return resolvedPeriod(DateTime.add(currentStart, { days: -days }), currentStart);
  }
  const start = calendarShift(currentStart, selection.unit, -selection.count);
  const wholeEnd = calendarShift(start, selection.unit, selection.count);
  const elapsedEnd = DateTime.add(start, { days: daysInPeriod(current) });
  return resolvedPeriod(
    start,
    selection.alignment === "elapsed" ? DateTime.min(elapsedEnd, wholeEnd) : wholeEnd,
  );
}

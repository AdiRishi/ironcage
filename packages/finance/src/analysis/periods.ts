import { CalendarDate, type Period, type PeriodSelection } from "@repo/contracts/finance";
import { DateTime } from "effect";

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
export function calendarShift(
  on: CalendarDate,
  unit: "week" | "month" | "quarter" | "year",
  count: number,
) {
  return CalendarDate.make(
    DateTime.formatIsoDateUtc(
      DateTime.add(
        DateTime.makeUnsafe(on),
        unit === "week"
          ? { weeks: count }
          : { months: count * (unit === "quarter" ? 3 : unit === "year" ? 12 : 1) },
      ),
    ),
  );
}
export function resolvePeriod(selection: PeriodSelection, today: CalendarDate): Period {
  if (selection.kind === "fixed")
    return { start: selection.start, endExclusive: selection.endExclusive };
  if (selection.kind === "rolling")
    return { start: addDays(today, 1 - selection.days), endExclusive: addDays(today, 1) };
  const parts = DateTime.toPartsUtc(DateTime.makeUnsafe(today));
  const start =
    selection.unit === "week"
      ? addDays(today, -((parts.weekDay + 6) % 7))
      : CalendarDate.make(
          `${today.slice(0, 4)}-${String(selection.unit === "year" ? 1 : selection.unit === "quarter" ? Math.floor((parts.month - 1) / 3) * 3 + 1 : parts.month).padStart(2, "0")}-01`,
        );
  const endExclusive = calendarShift(start, selection.unit, selection.offset + 1);
  return {
    start: calendarShift(start, selection.unit, selection.offset + 1 - selection.count),
    endExclusive:
      selection.offset === 0 && selection.alignment === "elapsed"
        ? addDays(today, 1)
        : endExclusive,
  };
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
): Period {
  if (comparison.kind === "fixed")
    return { start: comparison.start, endExclusive: comparison.endExclusive };
  if (comparison.kind === "previousYear") {
    const start = calendarShift(current.start, "year", -1);
    const endExclusive = calendarShift(current.endExclusive, "year", -1);
    return { start, endExclusive: endExclusive > start ? endExclusive : addDays(start, 1) };
  }
  if (selection.kind !== "calendar") {
    const days = daysInPeriod(current);
    return { start: addDays(current.start, -days), endExclusive: current.start };
  }
  const start = calendarShift(current.start, selection.unit, -selection.count);
  const wholeEnd = calendarShift(start, selection.unit, selection.count);
  const elapsedEnd = addDays(start, daysInPeriod(current));
  return {
    start,
    endExclusive:
      selection.alignment === "elapsed" && elapsedEnd < wholeEnd ? elapsedEnd : wholeEnd,
  };
}

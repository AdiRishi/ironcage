import type { Period, YearMonth } from "@repo/contracts/finance";
import { DateTime } from "effect";

import { addDays, yearMonthOf, yearMonthStart } from "../dates.ts";

const format = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-AU", { ...options, timeZone: "UTC" });
const dayFormat = format({ day: "numeric" });
const dayMonthFormat = format({ day: "numeric", month: "long" });
const dateFormat = format({ day: "numeric", month: "long", year: "numeric" });
const monthFormat = format({ month: "long" });
const monthYearFormat = format({ month: "long", year: "numeric" });
const yearFormat = format({ year: "numeric" });

export function monthLabel(month: YearMonth) {
  return DateTime.formatIntl(DateTime.makeUnsafe(yearMonthStart(month)), monthYearFormat);
}

export function periodLabel(period: Period) {
  const lastDay = addDays(period.endExclusive, -1);
  const first = DateTime.makeUnsafe(period.start);
  const last = DateTime.makeUnsafe(lastDay);
  const sameYear = period.start.slice(0, 4) === lastDay.slice(0, 4);
  const sameMonth = yearMonthOf(period.start) === yearMonthOf(lastDay);
  if (period.start.endsWith("-01") && period.endExclusive.endsWith("-01")) {
    if (sameMonth) return DateTime.formatIntl(first, monthYearFormat);
    if (sameYear && period.start.endsWith("-01-01") && period.endExclusive.endsWith("-01-01"))
      return DateTime.formatIntl(first, yearFormat);
    const from = DateTime.formatIntl(first, sameYear ? monthFormat : monthYearFormat);
    return `${from} to ${DateTime.formatIntl(last, monthYearFormat)}`;
  }
  if (period.start === lastDay) return DateTime.formatIntl(first, dateFormat);
  const from = DateTime.formatIntl(
    first,
    sameMonth ? dayFormat : sameYear ? dayMonthFormat : dateFormat,
  );
  return `${from} to ${DateTime.formatIntl(last, dateFormat)}`;
}

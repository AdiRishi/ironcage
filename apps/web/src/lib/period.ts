import {
  CalendarDate,
  type ComparisonSelection,
  type FlowInput,
  PeriodSelection,
  YearMonth,
} from "@repo/contracts/finance";
import {
  addDays,
  calendarDateIn,
  comparisonPeriod,
  monthsPeriod,
  periodLabel,
  yearMonthOf,
  yearMonthStart,
} from "@repo/finance";
import { DateTime, Result, Schema } from "effect";

// Range keys are written `first..last`, both included.
function ends(key: `${string}..${string}`) {
  const at = key.indexOf("..");
  return [key.slice(0, at), key.slice(at + 2)] as const;
}
const ordered = (message: string) =>
  Schema.makeFilter((key: `${string}..${string}`) => {
    const [first, last] = ends(key);
    return first <= last || message;
  });

// A year stays a number in the address, so it reads `?period=2026` rather than a
// quoted string.
const Year = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 9999 }));
const MonthRangeKey = Schema.TemplateLiteral([YearMonth, "..", YearMonth]).check(
  ordered("The first month must not come after the last."),
);
const DateRangeKey = Schema.TemplateLiteral([CalendarDate, "..", CalendarDate]).check(
  ordered("The first date must not come after the last."),
);

const MonthsKey = Schema.Union([Year, YearMonth, MonthRangeKey]);
function keyMonths(key: typeof MonthsKey.Type) {
  if (Schema.is(YearMonth)(key)) return { from: key, to: key };
  if (Schema.is(Year)(key)) {
    const year = String(key).padStart(4, "0");
    return { from: YearMonth.make(`${year}-01`), to: YearMonth.make(`${year}-12`) };
  }
  const [from, to] = ends(key);
  return { from: YearMonth.make(from), to: YearMonth.make(to) };
}

// The months every screen reads: `?period=2026`, `?period=2026-08`, or
// `?period=2026-03..2026-05`. Without one, screens read the current month. The months
// and both comparisons the overview and spending offer fall within years 0001 to 9999.
export const PeriodKey = MonthsKey.check(
  Schema.makeFilter((key) => {
    const { from, to } = keyMonths(key);
    return (
      (Schema.is(PeriodSelection)({ kind: "months", from, to }) &&
        Result.isSuccess(wholeComparisonOf(from, to, undefined)) &&
        Result.isSuccess(wholeComparisonOf(from, to, "lastYear"))) ||
      "Choose months whose period and comparisons fall between years 0001 and 9999."
    );
  }),
);
export type PeriodKey = typeof PeriodKey.Type;
// What the overview and spending compare with. Without one, it is the period before.
export const ComparisonKey = Schema.Union([Schema.Literal("lastYear"), DateRangeKey]);
export type ComparisonKey = typeof ComparisonKey.Type;
export const PeriodSearch = Schema.Struct({
  period: Schema.optional(PeriodKey),
  compare: Schema.optional(ComparisonKey),
});

// Whole months. The API decides whether the last of them is still in progress.
export type PeriodChoice = {
  readonly from: YearMonth;
  readonly to: YearMonth;
  readonly label: string;
};

// Today in the settings timezone. Period resolution reads no other clock.
export function today(timezone: string) {
  return calendarDateIn(DateTime.nowUnsafe(), timezone);
}
export function currentMonth(timezone: string) {
  return yearMonthOf(today(timezone));
}

export function resolvePeriodKey(key: PeriodKey | undefined, timezone: string): PeriodChoice {
  const { from, to } = keyMonths(key ?? currentMonth(timezone));
  return { from, to, label: periodLabel(monthsPeriod(from, to)) };
}

// The one key for a span of months: a month, a calendar year, or a range.
export function periodKey(from: YearMonth, to: YearMonth): PeriodKey {
  if (from === to) return from;
  const year = from.slice(0, 4);
  if (from === `${year}-01` && to === `${year}-12`) return Number(year);
  return `${from}..${to}`;
}

// Inclusive calendar dates, for filters that take a first and last date.
export function periodDates(period: PeriodChoice) {
  const { start, endExclusive } = monthsPeriod(period.from, period.to);
  return { from: start, to: addDays(endExclusive, -1) };
}

export function comparisonSelection(
  compare: ComparisonKey | undefined,
): typeof ComparisonSelection.Type {
  if (compare === undefined) return { kind: "previous" };
  if (compare === "lastYear") return { kind: "previousYear" };
  const [start, last] = ends(compare);
  return {
    kind: "fixed",
    start: CalendarDate.make(start),
    endExclusive: addDays(CalendarDate.make(last), 1),
  };
}

export function flowInput(
  period: PeriodChoice,
  compare: ComparisonKey | undefined,
  currency: string,
): FlowInput {
  return {
    period: { kind: "months", from: period.from, to: period.to },
    comparison: comparisonSelection(compare),
    basis: "spending",
    currency,
  };
}

function wholeComparisonOf(from: YearMonth, to: YearMonth, compare: ComparisonKey | undefined) {
  return comparisonPeriod(
    { kind: "months", from, to },
    comparisonSelection(compare),
    monthsPeriod(from, to),
  );
}
// What the whole months compare with, so a month in progress names the whole month
// before it, and comparisons not yet chosen can be named too. PeriodKey admits only
// months whose comparisons resolve, and chosen dates always do.
export function wholeComparison(period: PeriodChoice, compare: ComparisonKey | undefined) {
  return Result.getOrThrow(wholeComparisonOf(period.from, period.to, compare));
}

const initials = new Intl.DateTimeFormat("en-AU", { month: "narrow", timeZone: "UTC" });
// The month's first letter, for charts too narrow for its name.
export function monthInitial(month: YearMonth) {
  return initials.format(Date.parse(yearMonthStart(month)));
}

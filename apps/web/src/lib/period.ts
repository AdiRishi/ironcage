import { CalendarDate, type FlowInput, type PeriodSelection } from "@repo/contracts/finance";
import { Schema } from "effect";

// The period every screen reads, kept in the URL as `?period=2026-08` or `?period=2026`.
// No parameter means the current month so far.
export const PeriodKey = Schema.String.check(Schema.isPattern(/^\d{4}(-\d{2})?$/));
export const PeriodSearch = Schema.Struct({ period: Schema.optional(PeriodKey) });

const monthNames = new Intl.DateTimeFormat("en-AU", { month: "long" });
const monthShort = new Intl.DateTimeFormat("en-AU", { month: "short" });

export type ResolvedPeriod = {
  key: string | null;
  unit: "month" | "year";
  year: number;
  month: number | null;
  current: boolean;
  label: string;
  selection: PeriodSelection;
};

function today() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

export function resolvePeriodKey(key: string | undefined): ResolvedPeriod {
  const now = today();
  const [yearText, monthText] = (key ?? "").split("-");
  const year = key ? Number(yearText) : now.year;
  const month = key ? (monthText ? Number(monthText) : null) : now.month;
  if (month === null) {
    const offset = year - now.year;
    return {
      key: key ?? null,
      unit: "year",
      year,
      month: null,
      current: offset === 0,
      label: String(year),
      selection: {
        kind: "calendar",
        unit: "year",
        count: 1,
        offset: Math.min(0, offset),
        alignment: offset === 0 ? "elapsed" : "full",
      },
    };
  }
  const offset = (year - now.year) * 12 + (month - now.month);
  return {
    key: key ?? null,
    unit: "month",
    year,
    month,
    current: offset === 0,
    label: `${monthNames.format(new Date(year, month - 1, 1))} ${year}`,
    selection: {
      kind: "calendar",
      unit: "month",
      count: 1,
      offset: Math.max(-120, Math.min(0, offset)),
      alignment: offset === 0 ? "elapsed" : "full",
    },
  };
}

export function flowInput(period: ResolvedPeriod, currency: string): FlowInput {
  return {
    period: period.selection,
    comparison: { kind: "previous" },
    basis: "spending",
    currency,
  };
}

export function monthLabel(month: string) {
  const [year, value] = month.split("-").map(Number);
  return `${monthNames.format(new Date(year ?? 0, (value ?? 1) - 1, 1))} ${year}`;
}
export function monthInitial(month: string) {
  const [year, value] = month.split("-").map(Number);
  return monthShort.format(new Date(year ?? 0, (value ?? 1) - 1, 1)).slice(0, 1);
}

// Inclusive calendar dates for filters that take a from and to date.
export function periodDates(period: ResolvedPeriod) {
  const pad = (value: number) => String(value).padStart(2, "0");
  if (period.unit === "year")
    return {
      from: CalendarDate.make(`${period.year}-01-01`),
      to: CalendarDate.make(`${period.year}-12-31`),
    };
  const month = period.month ?? 1;
  const last = new Date(period.year, month, 0).getDate();
  return {
    from: CalendarDate.make(`${period.year}-${pad(month)}-01`),
    to: CalendarDate.make(`${period.year}-${pad(month)}-${pad(last)}`),
  };
}

export function periodRange(period: ResolvedPeriod) {
  const pad = (value: number) => String(value).padStart(2, "0");
  if (period.unit === "year")
    return {
      start: CalendarDate.make(`${period.year}-01-01`),
      endExclusive: CalendarDate.make(`${period.year + 1}-01-01`),
    };
  const month = period.month ?? 1;
  const next =
    month === 12 ? { year: period.year + 1, month: 1 } : { year: period.year, month: month + 1 };
  return {
    start: CalendarDate.make(`${period.year}-${pad(month)}-01`),
    endExclusive: CalendarDate.make(`${next.year}-${pad(next.month)}-01`),
  };
}

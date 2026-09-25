import { type CoverageState, type MonthTotal, YearMonth } from "@repo/contracts/finance";
import { monthsPeriod, periodLabel } from "@repo/finance";
import { Schema } from "effect";
import { expect, test, vi } from "vitest";

import {
  type ComparisonKey,
  comparisonSelection,
  periodDates,
  type PeriodKey,
  periodKey,
  periodRecords,
  PeriodSearch,
  resolvePeriodKey,
  wholeComparison,
} from "@/lib/period";

const decode = Schema.decodeUnknownResult(PeriodSearch);
const month = (value: string) => YearMonth.make(value);
const aud = (minor: bigint) => ({ currency: "AUD", minor });
const monthTotal = (
  value: string,
  coverage: CoverageState,
  outflow = 0n,
): typeof MonthTotal.Type => ({
  month: month(value),
  inflow: aud(0n),
  outflow: aud(outflow),
  spending: aud(outflow),
  coverage,
});

test("the address accepts a year as a number, month ranges, and last year's comparison", () => {
  expect(decode({ period: 2026 })).toMatchObject({ success: { period: 2026 } });
  expect(decode({ period: "2026" })).toMatchObject({ _tag: "Failure" });
  expect(decode({ period: "2026-03..2026-05", compare: "lastYear" })).toMatchObject({
    success: { period: "2026-03..2026-05", compare: "lastYear" },
  });
  expect(decode({ compare: "2026-03-01..2026-04-14" })).toMatchObject({
    success: { compare: "2026-03-01..2026-04-14" },
  });
});

test("the address rejects month 13, ranges that run backwards, and impossible dates", () => {
  for (const search of [
    { period: "2026-13" },
    { period: "2026-05..2026-03" },
    { compare: "2026-02-30..2026-03-02" },
    { compare: "2026-04-14..2026-03-01" },
  ])
    expect(decode(search)).toMatchObject({ _tag: "Failure" });
});

test("the address rejects months whose period or comparisons fall outside years 0001 to 9999", () => {
  for (const period of [9999, 0, "9999-12", "9999-06..9999-12", "0001-06", "0010-01..0019-12"])
    expect(decode({ period })).toMatchObject({ _tag: "Failure" });
  expect(decode({ period: "0002-01" })).toMatchObject({ success: { period: "0002-01" } });
});

test("a range of months covers every day from the first month to the end of the last", () => {
  const period = resolvePeriodKey("2025-11..2026-02", "Australia/Sydney");
  expect(monthsPeriod(period.from, period.to)).toEqual({
    start: "2025-11-01",
    endExclusive: "2026-03-01",
  });
  expect(periodDates(period)).toEqual({ from: "2025-11-01", to: "2026-02-28" });
  expect(period.label).toBe("November 2025 to February 2026");
});

test("without a key the current month is the settings timezone's, not the clock's", ({
  onTestFinished,
}) => {
  vi.useFakeTimers({ now: Date.parse("2026-08-31T15:00:00Z") });
  onTestFinished(() => {
    vi.useRealTimers();
  });
  expect(resolvePeriodKey(undefined, "Australia/Sydney")).toMatchObject({
    from: "2026-09",
    to: "2026-09",
  });
  expect(resolvePeriodKey(undefined, "UTC")).toMatchObject({ from: "2026-08", to: "2026-08" });
});

test("chosen months are written as a month, a calendar year, or a range", () => {
  expect(periodKey(month("2026-08"), month("2026-08"))).toBe("2026-08");
  expect(periodKey(month("2026-02"), month("2027-01"))).toBe("2026-02..2027-01");
  const year = periodKey(month("2024-01"), month("2024-12"));
  expect(year).toBe(2024);
  const period = resolvePeriodKey(year, "Australia/Sydney");
  expect(periodDates(period)).toEqual({ from: "2024-01-01", to: "2024-12-31" });
  expect(period.label).toBe("2024");
});

test("chosen comparison dates include their last day", () => {
  expect(comparisonSelection("2026-03-01..2026-04-14")).toEqual({
    kind: "fixed",
    start: "2026-03-01",
    endExclusive: "2026-04-15",
  });
});

test("the comparison is named after the whole months it covers", () => {
  const name = (key: PeriodKey, compare?: ComparisonKey) =>
    periodLabel(wholeComparison(resolvePeriodKey(key, "UTC"), compare));
  expect(name(month("2026-09"))).toBe("August 2026");
  expect(name(month("2026-09"), "lastYear")).toBe("September 2025");
  expect(name(month("2026-09"), "2026-03-01..2026-04-14")).toBe("1 March to 14 April 2026");
  expect(name(periodKey(month("2026-01"), month("2026-12")))).toBe("2025");
  expect(name("2026-07..2026-09")).toBe("April to June 2026");
});

test("a month that no file covers has no records even when a purchase is dated in it", () => {
  // A $31 purchase made on 31 January and posted on 2 February, when files cover only
  // February, counts toward January's spending.
  const months = [monthTotal("2025-01", "missing", 3100n), monthTotal("2025-02", "complete")];
  expect(periodRecords(months, resolvePeriodKey(month("2025-01"), "UTC"))).toBe("missing");
  expect(periodRecords(months, resolvePeriodKey(month("2025-02"), "UTC"))).toBe("recorded");
});

test("a year with any partly covered month has records", () => {
  const months = [monthTotal("2024-12", "missing"), monthTotal("2025-06", "partial")];
  expect(periodRecords(months, resolvePeriodKey(2025, "UTC"))).toBe("recorded");
  expect(periodRecords(months, resolvePeriodKey(2024, "UTC"))).toBe("missing");
  expect(periodRecords(months, resolvePeriodKey(month("2019-03"), "UTC"))).toBe("missing");
});

test("no months means nothing has been imported", () => {
  expect(periodRecords([], resolvePeriodKey(month("2025-03"), "UTC"))).toBe("none");
  expect(periodRecords([], resolvePeriodKey(2025, "UTC"))).toBe("none");
});

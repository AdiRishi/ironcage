import { CalendarDate, PeriodSelection, YearMonth } from "@repo/contracts/finance";
import { Result, Schema } from "effect";
import { expect, it } from "vitest";

import {
  comparisonPeriod,
  missingPeriods,
  periodsWithin,
  resolvePeriod,
  trailingYear,
  wholeMonths,
} from "../../src/analysis/periods.ts";
const day = (value: string) => CalendarDate.make(value);
it.each([
  { count: 2027, offset: 0 },
  { count: 1907, offset: -120 },
])("rejects annual periods before year 0001: %j", ({ count, offset }) => {
  const selection = PeriodSelection.make({
    kind: "calendar",
    unit: "year",
    count,
    offset,
    alignment: "full",
  });
  expect(resolvePeriod(selection, day("2026-08-20"))).toMatchObject({
    _tag: "Failure",
    failure: { kind: "invalid" },
  });
});
it.each([
  { count: 2026, offset: 0, endExclusive: "2027-01-01" },
  { count: 1906, offset: -120, endExclusive: "1907-01-01" },
])("allows annual periods beginning in year 0001: %j", ({ count, offset, endExclusive }) => {
  const selection = PeriodSelection.make({
    kind: "calendar",
    unit: "year",
    count,
    offset,
    alignment: "full",
  });
  expect(Result.getOrThrow(resolvePeriod(selection, day("2026-08-20")))).toEqual({
    start: "0001-01-01",
    endExclusive,
  });
});
it("rejects a previous period outside the calendar even when the current period is valid", () => {
  const selection = PeriodSelection.make({
    kind: "calendar",
    unit: "year",
    count: 1500,
    offset: 0,
    alignment: "full",
  });
  const current = Result.getOrThrow(resolvePeriod(selection, day("2026-08-20")));
  expect(current).toEqual({ start: "0527-01-01", endExclusive: "2027-01-01" });
  expect(comparisonPeriod(selection, { kind: "previous" }, current)).toMatchObject({
    _tag: "Failure",
    failure: { kind: "invalid" },
  });
});
it("rejects rolling and previous-year shifts outside the supported calendar", () => {
  expect(resolvePeriod({ kind: "rolling", days: 2 }, day("0001-01-01"))).toMatchObject({
    _tag: "Failure",
    failure: { kind: "invalid" },
  });
  expect(resolvePeriod({ kind: "rolling", days: 1 }, day("9999-12-31"))).toMatchObject({
    _tag: "Failure",
    failure: { kind: "invalid" },
  });
  const current = { start: day("0001-01-01"), endExclusive: day("0001-02-01") };
  expect(
    comparisonPeriod({ kind: "fixed", ...current }, { kind: "previousYear" }, current),
  ).toMatchObject({
    _tag: "Failure",
    failure: { kind: "invalid" },
  });
});
it("resolves rolling dates and Monday weeks without moving fixed dates", () => {
  expect(
    Result.getOrThrow(resolvePeriod({ kind: "rolling", days: 30 }, day("2026-08-20"))),
  ).toEqual({
    start: "2026-07-22",
    endExclusive: "2026-08-21",
  });
  expect(
    Result.getOrThrow(resolvePeriod({ kind: "rolling", days: 30 }, day("2026-08-27"))),
  ).toEqual({
    start: "2026-07-29",
    endExclusive: "2026-08-28",
  });
  expect(
    Result.getOrThrow(
      resolvePeriod(
        { kind: "fixed", start: day("2026-07-01"), endExclusive: day("2026-08-01") },
        day("2026-08-27"),
      ),
    ),
  ).toEqual({ start: "2026-07-01", endExclusive: "2026-08-01" });
  expect(
    Result.getOrThrow(
      resolvePeriod(
        { kind: "calendar", unit: "week", count: 1, offset: 0, alignment: "elapsed" },
        day("2026-08-23"),
      ),
    ),
  ).toEqual({ start: "2026-08-17", endExclusive: "2026-08-24" });
});
it("resolves a calendar period on its last day and combines overlapping coverage", () => {
  expect(
    Result.getOrThrow(
      resolvePeriod(
        { kind: "calendar", unit: "month", count: 1, offset: 0, alignment: "elapsed" },
        day("2026-08-31"),
      ),
    ),
  ).toEqual({ start: "2026-08-01", endExclusive: "2026-09-01" });
  expect(
    missingPeriods({ start: day("2026-08-01"), endExclusive: day("2026-09-01") }, [
      { start: day("2026-07-28"), endExclusive: day("2026-08-15") },
      { start: day("2026-08-10"), endExclusive: day("2026-08-29") },
    ]),
  ).toEqual([{ start: "2026-08-29", endExclusive: "2026-09-01" }]);
});

it("keeps the days of each interval that fall inside a period", () => {
  expect(
    periodsWithin({ start: day("2026-08-01"), endExclusive: day("2026-09-01") }, [
      { start: day("2026-06-01"), endExclusive: day("2026-07-01") },
      { start: day("2026-07-28"), endExclusive: day("2026-08-15") },
      { start: day("2026-08-20"), endExclusive: day("2026-09-10") },
    ]),
  ).toEqual([
    { start: "2026-08-01", endExclusive: "2026-08-15" },
    { start: "2026-08-20", endExclusive: "2026-09-01" },
  ]);
});

it("names the whole months a period spans, and none for a period that ends within a month", () => {
  expect(wholeMonths({ start: day("2026-07-01"), endExclusive: day("2026-09-01") })).toEqual({
    kind: "months",
    from: "2026-07",
    to: "2026-08",
  });
  expect(wholeMonths({ start: day("2026-08-01"), endExclusive: day("2026-08-27") })).toBeNull();
  expect(wholeMonths({ start: day("2026-07-15"), endExclusive: day("2026-09-01") })).toBeNull();
});

const months = (from: string, to: string) =>
  PeriodSelection.make({ kind: "months", from: YearMonth.make(from), to: YearMonth.make(to) });
it.each([
  {
    behaviour: "the month containing today ends after today",
    selection: months("2026-09", "2026-09"),
    today: "2026-09-25",
    expected: { start: "2026-09-01", endExclusive: "2026-09-26" },
  },
  {
    behaviour: "months running past today end after today",
    selection: months("2026-08", "2026-10"),
    today: "2026-09-25",
    expected: { start: "2026-08-01", endExclusive: "2026-09-26" },
  },
  {
    behaviour: "a month more than ten years back resolves to that month",
    selection: months("2015-06", "2015-06"),
    today: "2026-09-25",
    expected: { start: "2015-06-01", endExclusive: "2015-07-01" },
  },
  {
    behaviour: "a month after today resolves whole",
    selection: months("2026-10", "2026-10"),
    today: "2026-09-25",
    expected: { start: "2026-10-01", endExclusive: "2026-11-01" },
  },
  {
    behaviour: "months across a year end resolve whole",
    selection: months("2025-11", "2026-02"),
    today: "2026-09-25",
    expected: { start: "2025-11-01", endExclusive: "2026-03-01" },
  },
])("$behaviour", ({ selection, today, expected }) => {
  expect(Result.getOrThrow(resolvePeriod(selection, day(today)))).toEqual(expected);
});
it.each([
  {
    behaviour: "a month in progress compares with the same days of the month before",
    selection: months("2026-09", "2026-09"),
    today: "2026-09-25",
    comparison: "previous",
    expected: { start: "2026-08-01", endExclusive: "2026-08-26" },
  },
  {
    behaviour: "a month in progress compares with the same days a year earlier",
    selection: months("2026-09", "2026-09"),
    today: "2026-09-25",
    comparison: "previousYear",
    expected: { start: "2025-09-01", endExclusive: "2025-09-26" },
  },
  {
    behaviour: "February on the 28th of a leap year keeps 28 February of the year before",
    selection: months("2028-02", "2028-02"),
    today: "2028-02-28",
    comparison: "previousYear",
    expected: { start: "2027-02-01", endExclusive: "2027-03-01" },
  },
  {
    behaviour: "a leap year to date compares with the same calendar days of the year before",
    selection: months("2028-01", "2028-12"),
    today: "2028-09-25",
    comparison: "previous",
    expected: { start: "2027-01-01", endExclusive: "2027-09-26" },
  },
  {
    behaviour: "a month on its 30th compares with all of February and no more",
    selection: months("2027-03", "2027-03"),
    today: "2027-03-30",
    comparison: "previous",
    expected: { start: "2027-02-01", endExclusive: "2027-03-01" },
  },
  {
    behaviour: "three months in progress compare with the three months before to the same day",
    selection: months("2026-07", "2026-09"),
    today: "2026-09-25",
    comparison: "previous",
    expected: { start: "2026-04-01", endExclusive: "2026-06-26" },
  },
  {
    behaviour: "a whole February compares with the whole leap February before it",
    selection: months("2029-02", "2029-02"),
    today: "2029-06-01",
    comparison: "previousYear",
    expected: { start: "2028-02-01", endExclusive: "2028-03-01" },
  },
  {
    behaviour: "a week in progress compares with the same weekdays of the week before",
    selection: PeriodSelection.make({
      kind: "calendar",
      unit: "week",
      count: 1,
      offset: 0,
      alignment: "elapsed",
    }),
    today: "2026-08-19",
    comparison: "previous",
    expected: { start: "2026-08-10", endExclusive: "2026-08-13" },
  },
  {
    behaviour:
      "thirty days to 28 February of a leap year compare with the same dates a year earlier",
    selection: PeriodSelection.make({ kind: "rolling", days: 30 }),
    today: "2028-02-28",
    comparison: "previousYear",
    expected: { start: "2027-01-30", endExclusive: "2027-03-01" },
  },
] as const)("$behaviour", ({ selection, today, comparison, expected }) => {
  const current = Result.getOrThrow(resolvePeriod(selection, day(today)));
  expect(Result.getOrThrow(comparisonPeriod(selection, { kind: comparison }, current))).toEqual(
    expected,
  );
});
it("refuses months ending in December 9999, whose period would end in year 10000", () => {
  expect(
    Schema.is(PeriodSelection)({
      kind: "months",
      from: YearMonth.make("9999-12"),
      to: YearMonth.make("9999-12"),
    }),
  ).toBe(false);
});
it("rejects a comparison that falls before year 0001", () => {
  const selection = months("0001-01", "0001-03");
  const current = Result.getOrThrow(resolvePeriod(selection, day("2026-09-25")));
  expect(comparisonPeriod(selection, { kind: "previous" }, current)).toMatchObject({
    _tag: "Failure",
    failure: { kind: "invalid" },
  });
});
it("the twelve months behind a period end with the month of its last day", () => {
  expect(
    Result.getOrThrow(trailingYear({ start: day("2026-09-01"), endExclusive: day("2026-09-26") })),
  ).toEqual({ start: "2025-10-01", endExclusive: "2026-10-01" });
  expect(
    Result.getOrThrow(trailingYear({ start: day("2026-03-01"), endExclusive: day("2026-06-01") })),
  ).toEqual({ start: "2025-06-01", endExclusive: "2026-06-01" });
});
it("a period in year 0001 has no twelve months behind it", () => {
  expect(trailingYear({ start: day("0001-03-01"), endExclusive: day("0001-04-01") })).toMatchObject(
    { _tag: "Failure", failure: { kind: "invalid" } },
  );
});

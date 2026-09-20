import { CalendarDate, PeriodSelection } from "@repo/contracts/finance";
import { Result } from "effect";
import { expect, it } from "vitest";

import { resolvePeriod, comparisonPeriod, missingPeriods } from "../../src/analysis/periods.ts";
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

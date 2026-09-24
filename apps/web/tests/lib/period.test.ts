import { expect, test } from "vitest";

import { periodDates, periodRange, resolvePeriodKey } from "@/lib/period";

test("a December period ends at the start of the next year", () => {
  const period = resolvePeriodKey("2025-12");
  expect(periodRange(period)).toEqual({ start: "2025-12-01", endExclusive: "2026-01-01" });
  expect(periodDates(period)).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  expect(period.label).toBe("December 2025");
});

test("a year key selects the whole calendar year", () => {
  const period = resolvePeriodKey("2024");
  expect(period.unit).toBe("year");
  expect(periodRange(period)).toEqual({ start: "2024-01-01", endExclusive: "2025-01-01" });
  expect(periodDates(period)).toEqual({ from: "2024-01-01", to: "2024-12-31" });
});

test("a leap-year February ends on the 29th", () => {
  expect(periodDates(resolvePeriodKey("2024-02")).to).toBe("2024-02-29");
});

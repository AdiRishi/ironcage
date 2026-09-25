import { expect, it } from "@effect/vitest";
import { CalendarDate, YearMonth } from "@repo/contracts/finance";

import { monthLabel, periodLabel } from "../../src/index.ts";

it.each([
  { start: "2026-08-01", endExclusive: "2026-09-01", label: "August 2026" },
  { start: "2026-01-01", endExclusive: "2027-01-01", label: "2026" },
  { start: "2026-03-01", endExclusive: "2026-06-01", label: "March to May 2026" },
  { start: "2025-11-01", endExclusive: "2026-03-01", label: "November 2025 to February 2026" },
  { start: "2026-08-01", endExclusive: "2026-08-26", label: "1 to 25 August 2026" },
  { start: "2026-03-03", endExclusive: "2026-04-15", label: "3 March to 14 April 2026" },
  {
    start: "2025-12-28",
    endExclusive: "2026-01-04",
    label: "28 December 2025 to 3 January 2026",
  },
  { start: "2026-03-03", endExclusive: "2026-03-04", label: "3 March 2026" },
])("names $start to $endExclusive as $label", ({ start, endExclusive, label }) => {
  expect(
    periodLabel({ start: CalendarDate.make(start), endExclusive: CalendarDate.make(endExclusive) }),
  ).toBe(label);
});

it("names a month with its year", () => {
  expect(monthLabel(YearMonth.make("2026-08"))).toBe("August 2026");
});

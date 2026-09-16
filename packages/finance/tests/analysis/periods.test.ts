import { CalendarDate } from "@repo/contracts/finance";
import { expect, it } from "vitest";

import { resolvePeriod, missingPeriods } from "../../src/analysis/periods.ts";
const day = (value: string) => CalendarDate.make(value);
it("resolves rolling dates and Monday weeks without moving fixed dates", () => {
  expect(resolvePeriod({ kind: "rolling", days: 30 }, day("2026-08-20"))).toEqual({
    start: "2026-07-22",
    endExclusive: "2026-08-21",
  });
  expect(resolvePeriod({ kind: "rolling", days: 30 }, day("2026-08-27"))).toEqual({
    start: "2026-07-29",
    endExclusive: "2026-08-28",
  });
  expect(
    resolvePeriod(
      { kind: "fixed", start: day("2026-07-01"), endExclusive: day("2026-08-01") },
      day("2026-08-27"),
    ),
  ).toEqual({ start: "2026-07-01", endExclusive: "2026-08-01" });
  expect(
    resolvePeriod(
      { kind: "calendar", unit: "week", count: 1, offset: 0, alignment: "elapsed" },
      day("2026-08-23"),
    ),
  ).toEqual({ start: "2026-08-17", endExclusive: "2026-08-24" });
});
it("resolves a calendar period on its last day and combines overlapping coverage", () => {
  expect(
    resolvePeriod(
      { kind: "calendar", unit: "month", count: 1, offset: 0, alignment: "elapsed" },
      day("2026-08-31"),
    ),
  ).toEqual({ start: "2026-08-01", endExclusive: "2026-09-01" });
  expect(
    missingPeriods({ start: day("2026-08-01"), endExclusive: day("2026-09-01") }, [
      { start: day("2026-07-28"), endExclusive: day("2026-08-15") },
      { start: day("2026-08-10"), endExclusive: day("2026-08-29") },
    ]),
  ).toEqual([{ start: "2026-08-29", endExclusive: "2026-09-01" }]);
});

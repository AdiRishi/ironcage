import { CalendarDate, PersonalEventId, TagId, type AnalysisQuery } from "@repo/contracts/finance";
import { expect, it } from "vitest";

import { calculateContributors, calculateComparison } from "../../src/analysis/comparison.ts";
import { comparisonPeriod, resolvePeriod } from "../../src/analysis/periods.ts";
import { category, purchase, snapshot, card } from "./fixtures.ts";
const periods = {
  current: {
    start: CalendarDate.make("2026-08-01"),
    endExclusive: CalendarDate.make("2026-09-01"),
  },
  previous: {
    start: CalendarDate.make("2026-07-01"),
    endExclusive: CalendarDate.make("2026-08-01"),
  },
};
const query: AnalysisQuery = {
  period: { kind: "fixed", ...periods.current },
  comparison: { kind: "fixed", ...periods.previous },
  basis: "spending",
  currency: "AUD",
  accounts: [],
  measure: "netPersonalCosts",
  filters: { categories: [], merchants: [], tags: [], personalEvents: [] },
  normalization: "total",
};
const now = "2026-09-16T00:00:00.000Z";
it("explains the delivery increase with exact frequency and average-cost contributions", () => {
  const data = snapshot([
    ...Array.from({ length: 10 }, (_, i) => purchase(i + 1, 2000n, "2026-07-02")),
    ...Array.from({ length: 12 }, (_, i) => purchase(i + 11, 2500n, "2026-08-02", card)),
  ]);
  const result = calculateContributors(data, query, "category", periods, now);
  expect(result.comparison.delta).toEqual({
    kind: "money",
    amount: { currency: "AUD", minor: 10000n },
  });
  expect(result.comparison.relativeChange).toBe("50.000000");
  const row = result.rows[0];
  expect(row?.key).toBe(category);
  expect(row?.current.purchaseCount).toBe(12);
  expect(row?.previous.purchaseCount).toBe(10);
  expect(row?.current.averagePurchase?.value).toBe("25.000000");
  expect(row?.previous.averagePurchase?.value).toBe("20.000000");
  expect(row?.frequencyContribution?.minor).toBe(4500n);
  expect(row?.averageCostContribution?.minor).toBe(5500n);
});
it("allocates fractional and negative decomposition cents without losing the delta", () => {
  const result = calculateContributors(
    snapshot([purchase(1, 1n, "2026-07-02"), purchase(2, 1n), purchase(3, 1n)]),
    query,
    "category",
    periods,
    now,
  );
  expect(result.rows[0]?.frequencyContribution?.minor).toBe(1n);
  expect(result.rows[0]?.averageCostContribution?.minor).toBe(0n);
  expect(result.rows[0]?.delta).toEqual({ kind: "money", amount: { currency: "AUD", minor: 1n } });
});
it("selecting two tags counts a purchase once and marks overlapping breakdowns", () => {
  const one = TagId.make("00000000-0000-4000-8000-000000000030"),
    two = TagId.make("00000000-0000-4000-8000-000000000031");
  const event = purchase(1, 30000n);
  const data = snapshot([
    { ...event, allocations: [{ ...event.allocations[0], tagIds: [one, two] }] },
  ]);
  const result = calculateContributors(
    data,
    { ...query, filters: { ...query.filters, tags: [one, two] } },
    "tag",
    periods,
    now,
  );
  expect(result.comparison.current.total).toEqual({
    kind: "money",
    amount: { currency: "AUD", minor: 30000n },
  });
  expect(result.comparison.current.purchaseCount).toBe(1);
  expect(result.comparison.relativeChange).toBeNull();
  expect(result.rows).toHaveLength(2);
  expect(result.overlap).toBe(true);
  expect(result.remainder).toBeNull();
});
it("missing days disable daily averages without shrinking the denominator or hiding totals", () => {
  const data = snapshot([purchase(1, 31000n)]);
  data.sources = data.sources.map((source) => ({
    ...source,
    closingOn: CalendarDate.make("2026-08-28"),
  }));
  const result = calculateComparison(
    data,
    { ...query, normalization: "dailyAverage" },
    periods,
    now,
  );
  expect(result.current.total).toEqual({
    kind: "money",
    amount: { currency: "AUD", minor: 31000n },
  });
  expect(result.current.value.kind).toBe("unavailable");
  expect(result.current.days).toBe(31);
  expect(result.previous.value).toEqual({
    kind: "dailyAverage",
    amount: { currency: "AUD", value: "0.000000" },
  });
});
it("a trip includes advance payments when its purchase date is established", () => {
  const trip = PersonalEventId.make("00000000-0000-4000-8000-000000000060");
  const event = purchase(1, 45000n, "2026-06-02");
  const data = snapshot([
    {
      ...event,
      purchaseOn: CalendarDate.make("2026-08-10"),
      allocations: [{ ...event.allocations[0], personalEventIds: [trip] }],
    },
  ]);
  const selected = { ...query, filters: { ...query.filters, personalEvents: [trip] } };
  expect(calculateComparison(data, selected, periods, now).current.total).toEqual({
    kind: "money",
    amount: { currency: "AUD", minor: 45000n },
  });
  expect(
    calculateComparison(data, { ...selected, basis: "posted" }, periods, now).current.total,
  ).toEqual({ kind: "money", amount: { currency: "AUD", minor: 0n } });
});
it("elapsed comparisons align day counts and clamp month ends and leap years", () => {
  const selection = {
    kind: "calendar",
    unit: "month",
    count: 1,
    offset: 0,
    alignment: "elapsed",
  } satisfies AnalysisQuery["period"];
  const current = resolvePeriod(selection, CalendarDate.make("2026-08-20"));
  expect(comparisonPeriod(selection, { kind: "previous" }, current)).toEqual({
    start: "2026-07-01",
    endExclusive: "2026-07-21",
  });
  expect(
    comparisonPeriod(
      selection,
      { kind: "previous" },
      resolvePeriod(selection, CalendarDate.make("2026-03-31")),
    ),
  ).toEqual({ start: "2026-02-01", endExclusive: "2026-03-01" });
  expect(
    comparisonPeriod(
      { kind: "rolling", days: 1 },
      { kind: "previousYear" },
      { start: CalendarDate.make("2024-02-29"), endExclusive: CalendarDate.make("2024-03-01") },
    ),
  ).toEqual({ start: "2023-02-28", endExclusive: "2023-03-01" });
});

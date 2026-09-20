import { CalendarDate, PersonalEventId, TagId, type AnalysisQuery } from "@repo/contracts/finance";
import { Result } from "effect";
import { expect, it } from "vitest";

import { calculateContributors, calculateComparison } from "../../src/analysis/comparison.ts";
import { comparisonPeriod, resolvePeriod } from "../../src/analysis/periods.ts";
import { category, purchase, snapshot, card, deposit } from "./fixtures.ts";
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
it.each([
  { previous: [1n], current: [1n, 2n], frequency: 1n, average: 1n, delta: 2n },
  { previous: [1n, 2n], current: [1n], frequency: -1n, average: -1n, delta: -2n },
  { previous: [1n], current: [2n, 2n], frequency: 1n, average: 2n, delta: 3n },
])(
  "allocates fractional decomposition cents, including negative values and stable ties: $delta",
  ({ previous, current, frequency, average, delta }) => {
    const result = calculateContributors(
      snapshot([
        ...previous.map((minor, index) => purchase(index + 1, minor, "2026-07-02")),
        ...current.map((minor, index) => purchase(index + 100, minor, "2026-08-02")),
      ]),
      query,
      "category",
      periods,
      now,
    );
    expect(result.rows[0]?.frequencyContribution?.minor).toBe(frequency);
    expect(result.rows[0]?.averageCostContribution?.minor).toBe(average);
    expect(result.rows[0]?.delta).toEqual({
      kind: "money",
      amount: { currency: "AUD", minor: delta },
    });
  },
);
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
  const current = Result.getOrThrow(resolvePeriod(selection, CalendarDate.make("2026-08-20")));
  expect(Result.getOrThrow(comparisonPeriod(selection, { kind: "previous" }, current))).toEqual({
    start: "2026-07-01",
    endExclusive: "2026-07-21",
  });
  expect(
    Result.getOrThrow(
      comparisonPeriod(
        selection,
        { kind: "previous" },
        Result.getOrThrow(resolvePeriod(selection, CalendarDate.make("2026-03-31"))),
      ),
    ),
  ).toEqual({ start: "2026-02-01", endExclusive: "2026-03-01" });
  expect(
    Result.getOrThrow(
      comparisonPeriod(
        { kind: "rolling", days: 1 },
        { kind: "previousYear" },
        { start: CalendarDate.make("2024-02-29"), endExclusive: CalendarDate.make("2024-03-01") },
      ),
    ),
  ).toEqual({ start: "2023-02-28", endExclusive: "2023-03-01" });
});

it("an account contributor reports its own coverage when another selected account is missing dates", () => {
  const data = snapshot([purchase(1, 31000n), purchase(2, 62000n, "2026-08-02", card)]);
  data.sources = data.sources.filter((source) => source.accountId !== card);
  const result = calculateContributors(
    data,
    { ...query, normalization: "dailyAverage" },
    "account",
    periods,
    now,
  );
  expect(result.comparison.current.value.kind).toBe("unavailable");
  const covered = result.rows.find((row) => row.key === deposit);
  expect(covered?.current.value).toEqual({
    kind: "dailyAverage",
    amount: { currency: "AUD", value: "10.000000" },
  });
  expect(covered?.incomplete).toBe(false);
  expect(result.rows.find((row) => row.key === card)?.current.value.kind).toBe("unavailable");
});

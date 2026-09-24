import {
  CategoryId,
  CalendarDate,
  type FinancialEvent,
  type AnalysisRowsInput,
} from "@repo/contracts/finance";
import { expect, it } from "vitest";

import { calculateContributors } from "../../src/analysis/comparison.ts";
import { calculateRows } from "../../src/analysis/rows.ts";
import { category, purchase, snapshot } from "./fixtures.ts";
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
const input: AnalysisRowsInput = {
  query: {
    period: { kind: "fixed", ...periods.current },
    comparison: { kind: "fixed", ...periods.previous },
    basis: "spending",
    currency: "AUD",
    accounts: [],
    measure: "netPersonalCosts",
    normalization: "total",
    filters: { categories: [], counterparties: [], tags: [], personalEvents: [] },
  },
  groupBy: "category",
  groupKey: category,
};
it("paginates events sharing a date without duplicating or losing contributions", () => {
  const data = snapshot(Array.from({ length: 61 }, (_, i) => purchase(i + 1, 100n)));
  const first = calculateRows(data, input, periods, "2026-09-16T00:00:00.000Z");
  expect(first.rows).toHaveLength(50);
  expect(first.headline.current.total).toEqual({
    kind: "money",
    amount: { currency: "AUD", minor: 6100n },
  });
  expect(first.nextCursor).not.toBeNull();
  if (!first.nextCursor) throw new Error("Expected cursor");
  const second = calculateRows(
    data,
    { ...input, cursor: first.nextCursor },
    periods,
    "2026-09-16T00:00:01.000Z",
  );
  expect(second.rows).toHaveLength(11);
  expect(new Set([...first.rows, ...second.rows].map((row) => row.id)).size).toBe(61);
  expect(second.nextCursor).toBeNull();
});
it("shows all 22 purchases with August marked current and positive cost beside signed bank amounts", () => {
  const data = snapshot([
    ...Array.from({ length: 10 }, (_, i) => purchase(i + 1, 2000n, "2026-07-02")),
    ...Array.from({ length: 12 }, (_, i) => purchase(i + 11, 2500n)),
  ]);
  const result = calculateRows(data, input, periods, "2026-09-16T00:00:00.000Z");
  expect(result.rows).toHaveLength(22);
  expect(result.rows.filter((row) => row.period === "current")).toHaveLength(12);
  expect(result.rows[0]?.posting.amount.minor).toBe(-2500n);
  expect(result.rows[0]?.contribution).toEqual({
    kind: "money",
    amount: { currency: "AUD", minor: 2500n },
  });
});

it("the ten largest contributors and remainder partition the total and the remainder opens its records", () => {
  const categories = Array.from({ length: 12 }, (_, index) => ({
    id: CategoryId.make(`20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`),
    name: `Category ${index + 1}`,
    parentId: null,
    slug: null,
    tree: "spending" as const,
    position: index,
    archived: false,
    version: 1,
  }));
  const data = snapshot(
    categories.map((category, index) => {
      const event = purchase(index + 1, BigInt(index + 1) * 100n);
      return {
        ...event,
        allocations: [{ ...event.allocations[0], categoryId: category.id }],
      } satisfies FinancialEvent;
    }),
  );
  data.references = { ...data.references, categories };
  const result = calculateContributors(
    data,
    input.query,
    "category",
    periods,
    "2026-09-16T00:00:00.000Z",
  );
  expect(result.rows).toHaveLength(10);
  expect(result.rows.map((row) => row.label)).toEqual([
    "Category 12",
    "Category 11",
    "Category 10",
    "Category 9",
    "Category 8",
    "Category 7",
    "Category 6",
    "Category 5",
    "Category 4",
    "Category 3",
  ]);
  expect(result.comparison.delta).toEqual({
    kind: "money",
    amount: { currency: "AUD", minor: 7800n },
  });
  expect(result.remainder).toEqual({ kind: "money", amount: { currency: "AUD", minor: 300n } });
  const remainder = calculateRows(
    data,
    { ...input, groupKey: "remainder" },
    periods,
    "2026-09-16T00:00:00.000Z",
  );
  expect(remainder.headline.delta).toEqual(result.remainder);
  expect(remainder.rows).toHaveLength(2);
  expect(new Set(remainder.rows.map((row) => row.posting.amount.minor))).toEqual(
    new Set([-100n, -200n]),
  );
});

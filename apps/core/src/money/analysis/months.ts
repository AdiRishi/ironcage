import type { MonthAnalysis } from "@ironcage/contracts/schema";
import { monthOf, type CategoryId, type CategoryKind } from "@ironcage/domain";
import { BigDecimal, Option } from "effect";

import { decimal, toAud, zero } from "./amounts";
import type { SplitLine } from "./model";

export const previousMonths = (month: string, count: number): string[] => {
  const cursor = new Date(`${month}-01T00:00:00Z`);
  const result: string[] = [];
  for (let step = 0; step < count; step += 1) {
    cursor.setUTCMonth(cursor.getUTCMonth() - 1);
    result.push(cursor.toISOString().slice(0, 7));
  }
  return result;
};

interface MonthTotals {
  income: BigDecimal.BigDecimal;
  spendSum: BigDecimal.BigDecimal;
  categories: Map<CategoryId, { name: string; kind: CategoryKind; sum: BigDecimal.BigDecimal }>;
}

export const computeMonths = (
  lines: readonly SplitLine[],
  completeMonths: ReadonlySet<string>,
): readonly MonthAnalysis[] => {
  const totals = new Map<string, MonthTotals>();
  const monthFor = (month: string): MonthTotals => {
    const existing = totals.get(month);
    if (existing !== undefined) return existing;
    const created: MonthTotals = { income: zero, spendSum: zero, categories: new Map() };
    totals.set(month, created);
    return created;
  };

  for (const month of completeMonths) monthFor(month);
  for (const line of lines) {
    const month = monthFor(monthOf(line.postedDate));
    if (line.kind === "income") month.income = BigDecimal.sum(month.income, line.amount);
    else month.spendSum = BigDecimal.sum(month.spendSum, line.amount);

    const category = month.categories.get(line.categoryId);
    if (category === undefined) {
      month.categories.set(line.categoryId, {
        name: line.categoryName,
        kind: line.kind,
        sum: line.amount,
      });
    } else {
      category.sum = BigDecimal.sum(category.sum, line.amount);
    }
  }

  const months = [...totals.keys()].sort();
  const netSpendByMonth = new Map(
    months.map((month) => [month, BigDecimal.negate(totals.get(month)!.spendSum)]),
  );

  return months.map((month) => {
    const data = totals.get(month)!;
    const netSpend = netSpendByMonth.get(month)!;
    const complete = completeMonths.has(month);
    const ratio = BigDecimal.isPositive(data.income)
      ? BigDecimal.divide(BigDecimal.subtract(data.income, netSpend), data.income)
      : Option.none();
    const window = previousMonths(month, 3);

    return {
      month,
      complete,
      income: toAud(data.income),
      netSpend: toAud(netSpend),
      savingsRate: Option.isSome(ratio)
        ? BigDecimal.format(BigDecimal.round(ratio.value, { scale: 4, mode: "half-even" }))
        : null,
      trailingThreeMonthNetSpend:
        complete && window.every((previous) => completeMonths.has(previous))
          ? toAud(
              BigDecimal.divideUnsafe(
                window.reduce(
                  (sum, previous) => BigDecimal.sum(sum, netSpendByMonth.get(previous) ?? zero),
                  zero,
                ),
                decimal("3"),
              ),
            )
          : null,
      categories: [...data.categories.entries()]
        .map(([categoryId, category]) => ({
          categoryId,
          name: category.name,
          kind: category.kind,
          amount: toAud(
            category.kind === "expense" ? BigDecimal.negate(category.sum) : category.sum,
          ),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  });
};

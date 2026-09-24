import type {
  CategoryId,
  CategoryTree,
  FlowStream,
  PeriodChange,
  StreamKind,
} from "@repo/contracts/finance";

import { purchaseDecomposition } from "./decomposition.ts";
import type { FactMeasure } from "./facts.ts";

// Ledger facts summed for the current and comparison periods, per measure and category.
export type FlowRow = {
  measure: FactMeasure;
  categoryId: typeof CategoryId.Type | null;
  topCategoryId: typeof CategoryId.Type | null;
  current: bigint;
  previous: bigint;
  modelCurrent: bigint;
  purchases: number;
  previousPurchases: number;
};
export type CategoryNode = {
  id: typeof CategoryId.Type;
  parentId: typeof CategoryId.Type | null;
  name: string;
  slug: string | null;
  tree: CategoryTree;
  position: number;
};

const sum = (rows: readonly FlowRow[], pick: (row: FlowRow) => bigint) =>
  rows.reduce((total, row) => total + pick(row), 0n);

// Repayments include the interest already counted as spending on the loan, so only
// the rest reduces the principal. A month where interest posts before the repayment
// shows no principal rather than a negative one.
function principal(repayments: bigint, loanCosts: bigint) {
  return repayments > loanCosts ? repayments - loanCosts : 0n;
}

export function summarizeFlow({
  rows,
  categories,
  loanCosts,
  currency,
}: {
  rows: readonly FlowRow[];
  categories: readonly CategoryNode[];
  loanCosts: { current: bigint; previous: bigint };
  currency: string;
}) {
  const money = (minor: bigint) => ({ currency, minor });
  const of = (measure: FactMeasure) => rows.filter((row) => row.measure === measure);
  const category = (id: string | null) => categories.find((row) => row.id === id);
  const stream = (
    key: string,
    kind: StreamKind,
    label: string,
    selected: readonly FlowRow[],
    categoryId: typeof CategoryId.Type | null = null,
  ): FlowStream => ({
    key,
    kind,
    categoryId,
    slug: category(categoryId)?.slug ?? null,
    label,
    amount: money(sum(selected, (row) => row.current)),
    previous: money(sum(selected, (row) => row.previous)),
    modelAmount: money(sum(selected, (row) => row.modelCurrent)),
  });

  const spending = of("spending");
  const byTop = new Map<string | null, FlowRow[]>();
  for (const row of spending)
    byTop.set(row.topCategoryId, [...(byTop.get(row.topCategoryId) ?? []), row]);
  const spendingStreams = [...byTop.entries()]
    .map(([top, selected]) => {
      const node = category(top);
      return node
        ? stream(`category:${node.id}`, "category", node.name, selected, node.id)
        : stream("uncategorized", "uncategorized", "Not yet categorised", selected);
    })
    .toSorted(
      (a, b) =>
        (category(a.categoryId)?.position ?? 999) - (category(b.categoryId)?.position ?? 999),
    );

  const repayments = of("loanRepayment");
  const loanPrincipal: FlowStream = {
    ...stream("loanPrincipal", "loanPrincipal", "Loan principal", repayments),
    amount: money(
      principal(
        sum(repayments, (row) => row.current),
        loanCosts.current,
      ),
    ),
    previous: money(
      principal(
        sum(repayments, (row) => row.previous),
        loanCosts.previous,
      ),
    ),
  };
  const outflows = [
    ...spendingStreams,
    loanPrincipal,
    stream("externalOut", "externalOut", "To your other accounts", of("externalOut")),
    stream("unresolvedOut", "unresolvedOut", "Not yet understood", of("unresolvedOut")),
  ].filter((row) => row.amount.minor !== 0n || row.previous.minor !== 0n);

  const income = of("income");
  const incomeByCategory = new Map<string | null, FlowRow[]>();
  for (const row of income)
    incomeByCategory.set(row.categoryId, [...(incomeByCategory.get(row.categoryId) ?? []), row]);
  const inflows = [
    ...[...incomeByCategory.entries()].map(([id, selected]) => {
      const node = category(id);
      return stream(
        `income:${id ?? "other"}`,
        "income",
        node?.name ?? "Other income",
        selected,
        node?.id ?? null,
      );
    }),
    stream("borrowing", "borrowing", "Borrowed", of("borrowing")),
    stream("externalIn", "externalIn", "From your other accounts", of("externalIn")),
    stream("unresolvedIn", "unresolvedIn", "Not yet understood", of("unresolvedIn")),
  ].filter((row) => row.amount.minor !== 0n || row.previous.minor !== 0n);

  const totals = (pick: (stream: FlowStream) => bigint, pickRow: (row: FlowRow) => bigint) => ({
    inflow: money(inflows.reduce((total, row) => total + pick(row), 0n)),
    outflow: money(outflows.reduce((total, row) => total + pick(row), 0n)),
    spending: money(sum(spending, pickRow)),
    income: money(sum(income, pickRow)),
    internal: money(sum(of("internal"), pickRow)),
  });
  return {
    totals: totals(
      (row) => row.amount.minor,
      (row) => row.current,
    ),
    previousTotals: totals(
      (row) => row.previous.minor,
      (row) => row.previous,
    ),
    inflows,
    outflows,
    modelShare: money(sum(spending, (row) => row.modelCurrent)),
  };
}

// The subcategories whose spending changed most, largest absolute change first.
export function largestChanges({
  rows,
  categories,
  currency,
  limit,
}: {
  rows: readonly FlowRow[];
  categories: readonly CategoryNode[];
  currency: string;
  limit: number;
}): PeriodChange[] {
  const money = (minor: bigint) => ({ currency, minor });
  const byCategory = new Map<string | null, FlowRow[]>();
  for (const row of rows.filter((item) => item.measure === "spending"))
    byCategory.set(row.categoryId, [...(byCategory.get(row.categoryId) ?? []), row]);
  return [...byCategory.entries()]
    .map(([id, selected]) => {
      const node = categories.find((row) => row.id === id);
      const parent = node?.parentId ? categories.find((row) => row.id === node.parentId) : null;
      const current = sum(selected, (row) => row.current);
      const previous = sum(selected, (row) => row.previous);
      const purchases = selected.reduce((total, row) => total + row.purchases, 0);
      const previousPurchases = selected.reduce((total, row) => total + row.previousPurchases, 0);
      const parts = purchaseDecomposition({
        n0: BigInt(previousPurchases),
        n1: BigInt(purchases),
        t0: previous,
        t1: current,
      });
      return {
        categoryId: node?.id ?? null,
        label: node?.name ?? "Not yet categorised",
        parentLabel: parent?.name ?? null,
        current: money(current),
        previous: money(previous),
        purchases,
        previousPurchases,
        purchasesPart: parts ? money(parts.purchases) : null,
        averagePart: parts ? money(parts.average) : null,
      } satisfies PeriodChange;
    })
    .filter((change) => change.current.minor !== change.previous.minor)
    .toSorted((a, b) => {
      const delta = (change: PeriodChange) => {
        const value = change.current.minor - change.previous.minor;
        return value < 0n ? -value : value;
      };
      const difference = delta(b) - delta(a);
      return difference > 0n ? 1 : difference < 0n ? -1 : a.label.localeCompare(b.label);
    })
    .slice(0, limit);
}

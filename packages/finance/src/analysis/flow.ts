import type {
  CategoryId,
  CategoryScope,
  CategoryTree,
  CountedScope,
  FactMeasure,
  FlowStream,
  LedgerMeasure,
  PeriodChange,
  PeriodTotals,
} from "@repo/contracts/finance";

import { purchaseDecomposition } from "./decomposition.ts";
import { inCategoryScope, measures, measureTotal, uncategorisedLabel } from "./measures.ts";

// Ledger facts summed for the current and comparison periods, per measure, category, and
// whether they sit on a loan account.
export type FlowRow = {
  measure: FactMeasure;
  categoryId: typeof CategoryId.Type | null;
  loanAccount: boolean;
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

// Each stream sums the rows its counted scope selects: spending and income by top-level
// category with one more stream for each without a category, then every other measure
// whole.
export function summarizeFlow({
  rows,
  categories,
  currency,
}: {
  rows: readonly FlowRow[];
  categories: readonly CategoryNode[];
  currency: string;
}) {
  const money = (minor: bigint) => ({ currency, minor });
  const of = (measure: FactMeasure) => rows.filter((row) => row.measure === measure);
  const parents = new Map(categories.map((node) => [node.id, node.parentId]));
  const figures = (measure: LedgerMeasure, category: CategoryScope) => {
    const total = (pick: (row: FlowRow) => bigint) =>
      measureTotal(measure, (part) =>
        sum(
          rows.filter(
            (row) =>
              row.measure === part.fact &&
              (!part.loanAccounts || row.loanAccount) &&
              inCategoryScope(category, row.categoryId, parents),
          ),
          pick,
        ),
      );
    return {
      scope: { measure, category, counterparty: { kind: "all" } } satisfies CountedScope,
      amount: money(total((row) => row.current)),
      previous: money(total((row) => row.previous)),
      modelAmount: money(total((row) => row.modelCurrent)),
    };
  };
  const measureStream = (measure: Exclude<LedgerMeasure, "spending" | "income">): FlowStream => ({
    kind: measure,
    key: measure,
    label: measures[measure].label,
    ...figures(measure, { kind: "all" }),
  });
  const tops = categories
    .filter((node) => node.parentId === null)
    .toSorted((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  const drawn = (stream: FlowStream) => stream.amount.minor !== 0n || stream.previous.minor !== 0n;

  const outflows = [
    ...tops.map((node): FlowStream => ({
      kind: "category",
      key: `category:${node.id}`,
      categoryId: node.id,
      slug: node.slug,
      label: node.name,
      ...figures("spending", { kind: "category", id: node.id }),
    })),
    {
      kind: "uncategorised",
      key: "uncategorised",
      label: uncategorisedLabel,
      ...figures("spending", { kind: "uncategorised" }),
    } satisfies FlowStream,
    measureStream("loanPrincipal"),
    measureStream("externalOut"),
    measureStream("unresolvedOut"),
  ].filter(drawn);
  const inflows = [
    ...tops.map((node): FlowStream => ({
      kind: "income",
      key: `income:${node.id}`,
      label: node.name,
      ...figures("income", { kind: "category", id: node.id }),
    })),
    {
      kind: "income",
      key: "income:uncategorised",
      label: uncategorisedLabel,
      ...figures("income", { kind: "uncategorised" }),
    } satisfies FlowStream,
    measureStream("borrowing"),
    measureStream("externalIn"),
    measureStream("unresolvedIn"),
  ].filter(drawn);

  const totals = (pick: (stream: FlowStream) => bigint, pickRow: (row: FlowRow) => bigint) => ({
    inflow: money(inflows.reduce((total, stream) => total + pick(stream), 0n)),
    outflow: money(outflows.reduce((total, stream) => total + pick(stream), 0n)),
    spending: money(sum(of("spending"), pickRow)),
    income: money(sum(of("income"), pickRow)),
    internal: money(sum(of("internal"), pickRow)),
  });
  return {
    totals: totals(
      (stream) => stream.amount.minor,
      (row) => row.current,
    ),
    previousTotals: totals(
      (stream) => stream.previous.minor,
      (row) => row.previous,
    ),
    inflows,
    outflows,
    modelShare: money(sum(of("spending"), (row) => row.modelCurrent)),
  };
}

// What came in less what went out: the overview's left over, or its shortfall when
// negative.
export function leftOver({
  inflow,
  outflow,
}: Pick<typeof PeriodTotals.Type, "inflow" | "outflow">) {
  return { currency: inflow.currency, minor: inflow.minor - outflow.minor };
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
        label: node?.name ?? uncategorisedLabel,
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

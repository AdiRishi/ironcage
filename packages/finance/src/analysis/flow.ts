import type {
  CategoryId,
  CategoryScope,
  CountedScope,
  FactMeasure,
  FlowStream,
  LedgerMeasure,
  PeriodChange,
  PeriodTotals,
} from "@repo/contracts/finance";

import { hasChildren, type CategoryNode } from "./categories.ts";
import {
  inCategoryScope,
  measures,
  measureTotal,
  uncategorisedLabel,
  unspecifiedLabel,
} from "./measures.ts";
import { changeFigures, type ChangeSums } from "./spending.ts";

// Ledger facts summed for the current and comparison periods, per measure, category, and
// whether they sit on a loan account.
export type FlowRow = ChangeSums & {
  measure: FactMeasure;
  categoryId: typeof CategoryId.Type | null;
  loanAccount: boolean;
  modelCurrent: bigint;
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

// The categories whose own spending changed most, largest change first. A category with
// subcategories opens only what sits on it.
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
  const byCategory = new Map<typeof CategoryId.Type | null, FlowRow[]>();
  for (const row of rows.filter((item) => item.measure === "spending"))
    byCategory.set(row.categoryId, [...(byCategory.get(row.categoryId) ?? []), row]);
  const magnitude = ({ change }: PeriodChange) =>
    change.minor < 0n ? -change.minor : change.minor;
  return [...byCategory.entries()]
    .map(([id, selected]): PeriodChange => {
      const figures = changeFigures(
        {
          current: sum(selected, (row) => row.current),
          previous: sum(selected, (row) => row.previous),
          purchaseCurrent: sum(selected, (row) => row.purchaseCurrent),
          purchasePrevious: sum(selected, (row) => row.purchasePrevious),
          purchases: selected.reduce((total, row) => total + row.purchases, 0),
          previousPurchases: selected.reduce((total, row) => total + row.previousPurchases, 0),
        },
        currency,
      );
      const node = categories.find((row) => row.id === id);
      if (!node)
        return {
          category: { kind: "uncategorised" },
          label: uncategorisedLabel,
          parentLabel: null,
          ...figures,
        };
      const parent = node.parentId ? categories.find((row) => row.id === node.parentId) : null;
      const unspecified = hasChildren(categories, node.id);
      return {
        category: { kind: unspecified ? "unspecified" : "category", id: node.id },
        label: unspecified ? unspecifiedLabel(node.name) : node.name,
        parentLabel: parent?.name ?? null,
        ...figures,
      };
    })
    .filter((change) => change.change.minor !== 0n)
    .toSorted((a, b) => {
      const difference = magnitude(b) - magnitude(a);
      return difference > 0n ? 1 : difference < 0n ? -1 : a.label.localeCompare(b.label);
    })
    .slice(0, limit);
}

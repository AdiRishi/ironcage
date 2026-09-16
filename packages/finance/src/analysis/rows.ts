import type {
  AnalysisQuery,
  AnalysisRow,
  AnalysisRowCursor,
  AnalysisRowsInput,
  AnalysisRowsResult,
  ComparisonResult,
  MetricValue,
  Period,
} from "@repo/contracts/finance";

import { currencyExponent } from "../money.ts";
import { calculateComparison, calculateContributors } from "./comparison.ts";
import {
  contributionGroups,
  contributorSnapshot,
  groupLabel,
  selectContributions,
  type Contribution,
} from "./contributions.ts";
import { decimalRatio } from "./decimal.ts";
import type { AnalysisSnapshot } from "./measures.ts";
function rowValue(
  query: AnalysisQuery,
  amount: bigint,
  period: ComparisonResult["current"],
  income: bigint,
): MetricValue {
  if (period.value.kind === "unavailable") return period.value;
  if (query.measure === "purchaseCount") return { kind: "count", count: 1 };
  if (query.measure === "surplusRate")
    return income > 0n
      ? { kind: "percent", value: decimalRatio(amount * 100n, income) }
      : { kind: "unavailable", reason: "Income is not positive." };
  if (query.normalization === "dailyAverage")
    return {
      kind: "dailyAverage",
      amount: {
        currency: query.currency,
        value: decimalRatio(
          amount,
          BigInt(period.days) * 10n ** BigInt(currencyExponent(query.currency)),
        ),
      },
    };
  return { kind: "money", amount: { currency: query.currency, minor: amount } };
}
function compareCursor(a: typeof AnalysisRowCursor.Type, b: typeof AnalysisRowCursor.Type) {
  return b.on.localeCompare(a.on) || b.id.localeCompare(a.id) || a.period.localeCompare(b.period);
}
export function calculateRows(
  snapshot: AnalysisSnapshot,
  input: AnalysisRowsInput,
  periods: { current: Period; previous: Period },
  calculatedAt: string,
): AnalysisRowsResult {
  const { query, groupBy, groupKey } = input;
  const excludedKeys =
    groupKey === "remainder"
      ? new Set(
          calculateContributors(snapshot, query, groupBy, periods, calculatedAt).rows.map(
            (row) => row.key,
          ),
        )
      : new Set<string>();
  const select = (facts: readonly Contribution[]) =>
    facts.filter((fact) =>
      groupKey === "remainder"
        ? !contributionGroups(fact, groupBy).some((key) => excludedKeys.has(key))
        : contributionGroups(fact, groupBy).includes(groupKey),
    );
  const selected = {
    current: select(selectContributions(snapshot, query, periods.current)),
    previous: select(selectContributions(snapshot, query, periods.previous)),
  };
  const keys =
    groupKey === "remainder"
      ? new Set(
          snapshot.accounts
            .filter((account) => !excludedKeys.has(account.id))
            .map((account) => account.id),
        )
      : new Set([groupKey]);
  const headline = calculateComparison(
    contributorSnapshot(snapshot, groupBy, keys),
    query,
    periods,
    calculatedAt,
    selected,
  );
  const all: AnalysisRow[] = [];
  for (const period of ["current", "previous"] as const) {
    const facts = selected[period];
    const income = facts
      .filter((fact) => fact.allocation?.role === "income")
      .reduce((sum, fact) => sum + fact.amount, 0n);
    const groups = new Map<string, { first: Contribution; facts: Contribution[] }>();
    for (const fact of facts) {
      const id = fact.eventId ?? fact.posting.id;
      const group = groups.get(id);
      if (group) group.facts.push(fact);
      else groups.set(id, { first: fact, facts: [fact] });
    }
    for (const [id, group] of groups) {
      const posting = group.first.posting;
      const credits = [
        ...new Map(
          group.facts.flatMap((fact) => fact.credits).map((link) => [link.id, link]),
        ).values(),
      ];
      all.push({
        id,
        on: group.first.on,
        period,
        eventId: group.first.eventId,
        posting,
        counterparts: group.first.postings.filter((row) => row.id !== posting.id),
        credits,
        contribution: rowValue(
          query,
          group.facts.reduce((sum, fact) => sum + fact.amount, 0n),
          headline[period],
          income,
        ),
      });
    }
  }
  all.sort(compareCursor);
  const rows = all
    .filter((row) => !input.cursor || compareCursor(row, input.cursor) > 0)
    .slice(0, 51);
  const page = rows.slice(0, 50);
  const last = page.at(-1);
  return {
    headline,
    groupKey,
    label: groupKey === "remainder" ? "Everything else" : groupLabel(snapshot, groupBy, groupKey),
    rows: page,
    nextCursor: rows.length > 50 && last ? { on: last.on, id: last.id, period: last.period } : null,
  };
}

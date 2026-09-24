import type { AnalysisQuery, OverviewInput } from "@repo/contracts/finance";

export const defaultOverview: OverviewInput = {
  period: { kind: "calendar", unit: "month", count: 1, offset: 0, alignment: "elapsed" },
  basis: "spending",
  currency: "AUD",
  accounts: [],
};
const sortedIds = <Id extends string>(ids: readonly Id[]) => [...new Set(ids)].sort();
export function normalizeOverview(input: OverviewInput): OverviewInput {
  return { ...input, accounts: sortedIds(input.accounts) };
}
export function normalizeAnalysis(query: AnalysisQuery): AnalysisQuery {
  return {
    ...query,
    accounts: sortedIds(query.accounts),
    filters: {
      categories: sortedIds(query.filters.categories),
      counterparties: sortedIds(query.filters.counterparties),
      tags: sortedIds(query.filters.tags),
      personalEvents: sortedIds(query.filters.personalEvents),
    },
  };
}

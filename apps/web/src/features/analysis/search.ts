import { AnalysisQuery, GroupBy } from "@repo/contracts/finance";
import { Schema } from "effect";

import { defaultOverview, normalizeAnalysis } from "./input";
export const AnalysisSearch = Schema.Struct({
  query: Schema.optionalKey(AnalysisQuery),
  groupBy: Schema.optionalKey(GroupBy),
});
export type AnalysisSearch = typeof AnalysisSearch.Type;
export const defaultAnalysis: AnalysisQuery = {
  ...defaultOverview,
  measure: "netPersonalCosts",
  comparison: { kind: "previous" },
  filters: { categories: [], merchants: [], tags: [], personalEvents: [] },
  normalization: "total",
};
export function analysisInput(search: AnalysisSearch) {
  return {
    query: normalizeAnalysis(search.query ?? defaultAnalysis),
    groupBy: search.groupBy ?? "category",
  };
}

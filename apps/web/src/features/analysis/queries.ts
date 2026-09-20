import type { OverviewInput, ContributorsInput, AnalysisRowsInput } from "@repo/contracts/finance";
import { queryOptions } from "@tanstack/react-query";

import { overview, contributors, rows } from "./functions";
import { normalizeAnalysis, normalizeOverview } from "./input";
export const overviewQuery = (input: OverviewInput) =>
  queryOptions({
    queryKey: ["analysis", "overview", normalizeOverview(input)],
    queryFn: () => overview({ data: input }),
    staleTime: 0,
    refetchOnMount: false,
  });

export const contributorsQuery = (input: typeof ContributorsInput.Type) =>
  queryOptions({
    queryKey: ["analysis", "contributors", { ...input, query: normalizeAnalysis(input.query) }],
    queryFn: () => contributors({ data: input }),
    staleTime: 0,
    refetchOnMount: false,
  });

export const analysisRowsQuery = (input: AnalysisRowsInput) =>
  queryOptions({
    queryKey: ["analysis", "rows", { ...input, query: normalizeAnalysis(input.query) }],
    queryFn: () => rows({ data: input }),
    staleTime: 0,
    refetchOnMount: false,
  });

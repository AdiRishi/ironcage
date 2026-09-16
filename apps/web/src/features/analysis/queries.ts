import type { OverviewInput, ContributorsInput, AnalysisRowsInput } from "@repo/contracts/finance";
import { queryOptions } from "@tanstack/react-query";

import { overview, contributors, rows } from "./functions";
export const overviewQuery = (input: OverviewInput) =>
  queryOptions({
    queryKey: ["analysis", "overview", input],
    queryFn: () => overview({ data: input }),
    staleTime: 0,
  });

export const contributorsQuery = (input: typeof ContributorsInput.Type) =>
  queryOptions({
    queryKey: ["analysis", "contributors", input],
    queryFn: () => contributors({ data: input }),
    staleTime: 0,
  });

export const analysisRowsQuery = (input: AnalysisRowsInput) =>
  queryOptions({
    queryKey: ["analysis", "rows", input],
    queryFn: () => rows({ data: input }),
    staleTime: 0,
  });

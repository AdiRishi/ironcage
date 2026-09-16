import type { GetAnalysis } from "@repo/contracts/finance";
import { queryOptions } from "@tanstack/react-query";

import { contributors } from "./functions";
import { getAnalysis, listAnalyses } from "./saved-functions";

export const analysesQuery = () =>
  queryOptions({
    queryKey: ["savedAnalyses"],
    queryFn: () => listAnalyses(),
  });
export const savedResultQuery = (input: typeof GetAnalysis.Type) =>
  queryOptions({
    queryKey: ["savedAnalysisResult", input.id],
    queryFn: async () => {
      const analysis = await getAnalysis({ data: input });
      const result = await contributors({ data: analysis.definition });
      return { analysis, result };
    },
    staleTime: "static",
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

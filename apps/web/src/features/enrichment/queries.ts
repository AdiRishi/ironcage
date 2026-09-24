import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { getEnrichmentSettings, listCategoryProposals, listEnrichmentRuns } from "./functions";

export const enrichmentSettingsQuery = () =>
  queryOptions({ queryKey: ["enrichmentSettings"], queryFn: () => getEnrichmentSettings() });
export const categoryProposalsQuery = () =>
  queryOptions({ queryKey: ["categoryProposals"], queryFn: () => listCategoryProposals() });

// While a run is active, poll it; every finished batch changes interpretations.
export function useEnrichmentRuns() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["enrichmentRuns"],
    queryFn: () => listEnrichmentRuns(),
    refetchInterval: (state) =>
      state.state.data?.some((run) => run.status === "pending" || run.status === "running")
        ? 4000
        : false,
  });
  useEffect(() => {
    client
      .invalidateQueries({ predicate: (entry) => entry.queryKey[0] !== "enrichmentRuns" })
      .catch(reportError);
  }, [client, query.dataUpdatedAt]);
  return query;
}

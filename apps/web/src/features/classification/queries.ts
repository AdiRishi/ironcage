import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { listClassificationRuns } from "./functions";

export function useClassificationRuns() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["classificationRuns"],
    queryFn: () => listClassificationRuns(),
    refetchInterval: (state) =>
      state.state.data?.some((run) => run.status === "pending" || run.status === "running")
        ? 4000
        : false,
  });
  useEffect(() => {
    client.invalidateQueries({ queryKey: ["suggestion"] }).catch(reportError);
    client.invalidateQueries({ queryKey: ["suggestions"] }).catch(reportError);
    client.invalidateQueries({ queryKey: ["modelUsage"] }).catch(reportError);
  }, [client, query.dataUpdatedAt]);
  return query;
}

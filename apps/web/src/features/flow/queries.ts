import type { FlowInput } from "@repo/contracts/finance";
import { queryOptions } from "@tanstack/react-query";

import { getFactsStatus, getMonthlyFlow, getPeriodFlow } from "./functions";

export const periodFlowQuery = (input: FlowInput) =>
  queryOptions({ queryKey: ["periodFlow", input], queryFn: () => getPeriodFlow({ data: input }) });
export const monthlyFlowQuery = (currency: string) =>
  queryOptions({
    queryKey: ["monthlyFlow", currency],
    queryFn: () => getMonthlyFlow({ data: { currency } }),
  });
// Polls while a background rebuild is recalculating totals, in a background tab too,
// so screens left open refetch when it finishes.
export const factsStatusQuery = () =>
  queryOptions({
    queryKey: ["factsStatus"],
    queryFn: () => getFactsStatus(),
    refetchInterval: (query) => (query.state.data?.outdated ? 3000 : false),
    refetchIntervalInBackground: true,
  });

import type { FlowInput, SpendingInput } from "@repo/contracts/finance";
import { queryOptions } from "@tanstack/react-query";

import { getMonthlyFlow, getPeriodFlow, getSpending } from "./functions";

export const periodFlowQuery = (input: FlowInput) =>
  queryOptions({ queryKey: ["periodFlow", input], queryFn: () => getPeriodFlow({ data: input }) });
export const monthlyFlowQuery = (currency: string) =>
  queryOptions({
    queryKey: ["monthlyFlow", currency],
    queryFn: () => getMonthlyFlow({ data: { currency } }),
  });
export const spendingQuery = (input: SpendingInput) =>
  queryOptions({ queryKey: ["spending", input], queryFn: () => getSpending({ data: input }) });

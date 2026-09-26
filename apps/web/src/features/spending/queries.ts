import type { SpendingInput } from "@repo/contracts/finance";
import { queryOptions } from "@tanstack/react-query";

import { getSpending } from "./functions";

export const spendingQuery = (input: SpendingInput) =>
  queryOptions({ queryKey: ["getSpending", input], queryFn: () => getSpending({ data: input }) });

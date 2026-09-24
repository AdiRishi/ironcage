import type { ListPostings, PostingInput } from "@repo/contracts/finance";
import { queryOptions } from "@tanstack/react-query";

import { getPosting, listLedger } from "./functions";

export const ledgerQuery = (input: typeof ListPostings.Type) =>
  queryOptions({ queryKey: ["ledger", input], queryFn: () => listLedger({ data: input }) });
export const postingQueryOptions = (input: typeof PostingInput.Type) =>
  queryOptions({ queryKey: ["posting", input], queryFn: () => getPosting({ data: input }) });

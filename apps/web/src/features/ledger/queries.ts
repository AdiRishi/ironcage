import type { ListCountedLedger, ListPostings, PostingInput } from "@repo/contracts/finance";
import { queryOptions } from "@tanstack/react-query";

import { getPosting, listCountedLedger, listLedger } from "./functions";

export const ledgerQuery = (input: typeof ListPostings.Type) =>
  queryOptions({ queryKey: ["ledger", input], queryFn: () => listLedger({ data: input }) });
export const countedLedgerQuery = (input: typeof ListCountedLedger.Type) =>
  queryOptions({
    queryKey: ["listCountedLedger", input],
    queryFn: () => listCountedLedger({ data: input }),
  });
export const postingQueryOptions = (input: typeof PostingInput.Type) =>
  queryOptions({ queryKey: ["posting", input], queryFn: () => getPosting({ data: input }) });

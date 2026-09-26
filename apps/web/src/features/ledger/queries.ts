import type {
  CountedCursor,
  ListCountedLedger,
  ListPostings,
  PostingInput,
} from "@repo/contracts/finance";
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";

import { getPosting, listCountedLedger, listLedger } from "./functions";

export const ledgerQuery = (input: typeof ListPostings.Type) =>
  queryOptions({ queryKey: ["ledger", input], queryFn: () => listLedger({ data: input }) });
export const countedLedgerQuery = (input: typeof ListCountedLedger.Type) =>
  queryOptions({
    queryKey: ["listCountedLedger", input],
    queryFn: () => listCountedLedger({ data: input }),
  });
// The records behind a number page after page, for lists that grow with "Show older".
export const countedLedgerPagesQuery = (input: Omit<typeof ListCountedLedger.Type, "cursor">) =>
  infiniteQueryOptions({
    queryKey: ["listCountedLedger", input, "pages"],
    initialPageParam: null,
    queryFn: ({ pageParam }: { pageParam: typeof CountedCursor.Type | null }) =>
      listCountedLedger({ data: pageParam ? { ...input, cursor: pageParam } : input }),
    getNextPageParam: (page) => page.nextCursor,
  });
export const postingQueryOptions = (input: typeof PostingInput.Type) =>
  queryOptions({ queryKey: ["posting", input], queryFn: () => getPosting({ data: input }) });

import { ListPostings, PostingInput } from "@repo/contracts/finance";
import { queryOptions } from "@tanstack/react-query";

import { getPosting, listPostings } from "./functions";
export const postingsQueryOptions = (input: typeof ListPostings.Type) =>
  queryOptions({ queryKey: ["postings", input], queryFn: () => listPostings({ data: input }) });
export const postingQueryOptions = (input: typeof PostingInput.Type) =>
  queryOptions({ queryKey: ["posting", input], queryFn: () => getPosting({ data: input }) });

import { ListPostings, PostingCursor, PostingFilter } from "@repo/contracts/finance";
import { Schema } from "effect";

import { postingsQueryOptions } from "./queries";

export const TransactionSearch = Schema.Struct({
  ...PostingFilter.fields,
  cursor: Schema.optionalKey(PostingCursor),
});
export type TransactionSearch = typeof TransactionSearch.Type;
export function transactionQuery(search: TransactionSearch) {
  const { cursor, ...filter } = search;
  const input: typeof ListPostings.Type = cursor ? { filter, cursor } : { filter };
  return postingsQueryOptions(input);
}

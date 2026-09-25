import { PostingCursor, PostingFilter, type ListPostings } from "@repo/contracts/finance";
import { Schema } from "effect";

import { periodDates, type PeriodChoice } from "@/lib/period";

export const LedgerSearch = Schema.Struct({
  ...PostingFilter.fields,
  cursor: Schema.optionalKey(PostingCursor),
});
export type LedgerSearch = typeof LedgerSearch.Type;

// The ledger reads the selected period unless you chose your own dates or one import,
// which shows everything that file supports.
export function ledgerInput(search: LedgerSearch, period: PeriodChoice): typeof ListPostings.Type {
  const { cursor, ...filter } = search;
  const withPeriod =
    filter.from || filter.to || filter.importId ? filter : { ...filter, ...periodDates(period) };
  return cursor ? { filter: withPeriod, cursor } : { filter: withPeriod };
}

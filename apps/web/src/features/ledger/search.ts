import {
  CountedCursor,
  CountedFilter,
  type CountedScope,
  LedgerMeasure,
  type ListCountedLedger,
  type ListPostings,
  PostingCursor,
  PostingFilter,
} from "@repo/contracts/finance";
import { monthsDates } from "@repo/finance";
import { Schema, Struct } from "effect";

import { analysisBasis, periodSelection, type PeriodChoice } from "@/lib/period";
import { ScopeSearch, scopeSearch, searchScope, unspecifiedNeedsCategory } from "@/lib/scope";

// The records behind one number: `?measure=` narrowed by a scope. The scope sets the
// dates and currency, so the posting filters that would set them are left out.
export const CountedSearch = Schema.Struct({
  measure: LedgerMeasure,
  ...ScopeSearch.fields,
  ...CountedFilter.fields,
  cursor: Schema.optionalKey(CountedCursor),
}).check(unspecifiedNeedsCategory);
export type CountedSearch = typeof CountedSearch.Type;
export const PostingSearch = Schema.Struct({
  measure: Schema.optionalKey(Schema.Never),
  ...PostingFilter.fields,
  cursor: Schema.optionalKey(PostingCursor),
});
export type PostingSearch = typeof PostingSearch.Type;
export const LedgerSearch = Schema.Union([CountedSearch, PostingSearch]);
export type LedgerSearch = typeof LedgerSearch.Type;

// The filters in an address, without the parameters around them.
export const postingFilter = (search: typeof PostingFilter.Type) =>
  Struct.pick(search, Struct.keys(PostingFilter.fields));
export const countedFilter = (search: typeof CountedFilter.Type) =>
  Struct.pick(search, Struct.keys(CountedFilter.fields));

// The ledger reads the selected period unless you chose your own dates, one import, which
// shows everything that file supports, or one question, which shows every transaction it
// covers.
export function ledgerInput(search: PostingSearch, period: PeriodChoice): typeof ListPostings.Type {
  const filter = postingFilter(search);
  const withPeriod =
    filter.from || filter.to || filter.importId || filter.questionId
      ? filter
      : { ...filter, ...monthsDates(period.from, period.to) };
  return search.cursor ? { filter: withPeriod, cursor: search.cursor } : { filter: withPeriod };
}

export function countedScope(search: CountedSearch): CountedScope {
  return { measure: search.measure, ...searchScope(search) };
}

// The counted ledger reads the months the screens read, on the same date basis, so its
// total is the number it was opened from.
export function countedLedgerInput(
  search: CountedSearch,
  period: PeriodChoice,
  currency: string,
): typeof ListCountedLedger.Type {
  const input = {
    scope: countedScope(search),
    period: periodSelection(period),
    basis: analysisBasis,
    currency,
    filter: countedFilter(search),
  };
  return search.cursor ? { ...input, cursor: search.cursor } : input;
}

// The address of the records behind a scope.
export function countedSearch({ measure, ...scope }: CountedScope): CountedSearch {
  return { measure, ...scopeSearch(scope) };
}

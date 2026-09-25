import {
  CategoryChoice,
  type CategoryScope,
  CountedCursor,
  CountedFilter,
  type CountedScope,
  type CounterpartyScope,
  CounterpartyId,
  LedgerMeasure,
  type ListCountedLedger,
  type ListPostings,
  PostingCursor,
  PostingFilter,
} from "@repo/contracts/finance";
import { Schema, Struct, type Types } from "effect";

import { analysisBasis, periodDates, periodSelection, type PeriodChoice } from "@/lib/period";

// The records behind one number: `?measure=` narrowed by `?category=` (an ID or
// `uncategorised`), `?unspecified=true` for only what sits on the category itself, and
// `?counterparty=` (an ID or `unidentified`). The scope sets the dates and currency, so
// the posting filters that would set them are left out.
export const CountedSearch = Schema.Struct({
  measure: LedgerMeasure,
  category: Schema.optionalKey(CategoryChoice),
  unspecified: Schema.optionalKey(Schema.Literal(true)),
  counterparty: Schema.optionalKey(Schema.Union([CounterpartyId, Schema.Literal("unidentified")])),
  ...CountedFilter.fields,
  cursor: Schema.optionalKey(CountedCursor),
}).check(
  Schema.makeFilter(
    ({ category, unspecified }) =>
      !unspecified ||
      (category !== undefined && category !== "uncategorised") ||
      "Only a category can be narrowed to what sits on it.",
  ),
);
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

// The ledger reads the selected period unless you chose your own dates or one import,
// which shows everything that file supports.
export function ledgerInput(search: PostingSearch, period: PeriodChoice): typeof ListPostings.Type {
  const filter = postingFilter(search);
  const withPeriod =
    filter.from || filter.to || filter.importId ? filter : { ...filter, ...periodDates(period) };
  return search.cursor ? { filter: withPeriod, cursor: search.cursor } : { filter: withPeriod };
}

function categoryScope({ category, unspecified }: CountedSearch): CategoryScope {
  if (category === undefined) return { kind: "all" };
  if (category === "uncategorised") return { kind: "uncategorised" };
  return unspecified ? { kind: "unspecified", id: category } : { kind: "category", id: category };
}

function counterpartyScope({ counterparty }: CountedSearch): CounterpartyScope {
  if (counterparty === undefined) return { kind: "all" };
  if (counterparty === "unidentified") return { kind: "unidentified" };
  return { kind: "counterparty", id: counterparty };
}

export function countedScope(search: CountedSearch): CountedScope {
  return {
    measure: search.measure,
    category: categoryScope(search),
    counterparty: counterpartyScope(search),
  };
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
export function countedSearch({ measure, category, counterparty }: CountedScope) {
  const search: Types.Mutable<CountedSearch> = { measure };
  if (category.kind === "uncategorised") search.category = "uncategorised";
  if (category.kind === "category" || category.kind === "unspecified")
    search.category = category.id;
  if (category.kind === "unspecified") search.unspecified = true;
  if (counterparty.kind === "unidentified") search.counterparty = "unidentified";
  if (counterparty.kind === "counterparty") search.counterparty = counterparty.id;
  return search;
}

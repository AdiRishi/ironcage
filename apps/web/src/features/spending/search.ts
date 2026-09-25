import { PersonalEventId, type Scope, type SpendingInput, TagId } from "@repo/contracts/finance";
import { Schema, type Types } from "effect";

import { countedLedgerInput, countedSearch, type CountedSearch } from "@/features/ledger/search";
import { type ComparisonKey, flowInput, type PeriodChoice } from "@/lib/period";
import { ScopeSearch, scopeSearch, searchScope, unspecifiedNeedsCategory } from "@/lib/scope";

// The scope the drill has opened, and `?tag=` or `?personalEvent=` to count only the
// spending that carries it.
export const SpendingSearch = Schema.Struct({
  ...ScopeSearch.fields,
  tag: Schema.optionalKey(TagId),
  personalEvent: Schema.optionalKey(PersonalEventId),
}).check(unspecifiedNeedsCategory);
export type SpendingSearch = typeof SpendingSearch.Type;
// The tag or personal event that narrows spending, kept from level to level.
export type Narrowing = {
  tag: SpendingSearch["tag"];
  personalEvent: SpendingSearch["personalEvent"];
};
export const narrowingOf = ({ tag, personalEvent }: SpendingSearch): Narrowing => ({
  tag,
  personalEvent,
});

export function spendingInput(
  search: SpendingSearch,
  period: PeriodChoice,
  compare: ComparisonKey | undefined,
  currency: string,
): SpendingInput {
  const input: Types.Mutable<SpendingInput> = {
    ...flowInput(period, compare, currency),
    ...searchScope(search),
  };
  if (search.tag) input.tagId = search.tag;
  if (search.personalEvent) input.personalEventId = search.personalEvent;
  return input;
}

// The address of another scope, still narrowed to the same tag or personal event.
export function spendingSearch(scope: Scope, { tag, personalEvent }: Narrowing) {
  const search: Types.Mutable<SpendingSearch> = scopeSearch(scope);
  if (tag) search.tag = tag;
  if (personalEvent) search.personalEvent = personalEvent;
  return search;
}

// The address of the records behind a scope's spending, narrowed the same way.
export function ledgerSearch(scope: Scope, { tag, personalEvent }: Narrowing) {
  const search: Types.Mutable<CountedSearch> = countedSearch({ measure: "spending", ...scope });
  if (tag) search.tagId = tag;
  if (personalEvent) search.personalEventId = personalEvent;
  return search;
}

// The records the drill's last level lists: the same input the ledger reads for them.
export function transactionsInput(search: SpendingSearch, period: PeriodChoice, currency: string) {
  return countedLedgerInput(
    ledgerSearch(searchScope(search), narrowingOf(search)),
    period,
    currency,
  );
}

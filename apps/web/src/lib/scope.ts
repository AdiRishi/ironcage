import {
  CategoryChoice,
  type CategoryScope,
  CounterpartyId,
  type CounterpartyScope,
  type Scope,
} from "@repo/contracts/finance";
import { Schema, type Types } from "effect";

// A scope in an address: `?category=` (an ID, which includes everything below it, or
// `uncategorised`), `?unspecified=true` for only what sits on the category itself, and
// `?counterparty=` (an ID or `unidentified`). Without them, the scope is everything.
export const ScopeSearch = Schema.Struct({
  category: Schema.optionalKey(CategoryChoice),
  unspecified: Schema.optionalKey(Schema.Literal(true)),
  counterparty: Schema.optionalKey(Schema.Union([CounterpartyId, Schema.Literal("unidentified")])),
});
export type ScopeSearch = typeof ScopeSearch.Type;
// Every address that holds a scope checks it with this, since spreading the fields into
// a wider schema leaves the check behind.
export const unspecifiedNeedsCategory = Schema.makeFilter(
  ({ category, unspecified }: ScopeSearch) =>
    !unspecified ||
    (category !== undefined && category !== "uncategorised") ||
    "Only a category can be narrowed to what sits on it.",
);

// All spending, or all of a measure: the scope with nothing narrowed.
export const everything = {
  category: { kind: "all" },
  counterparty: { kind: "all" },
} as const satisfies Scope;

function categoryScope({ category, unspecified }: ScopeSearch): CategoryScope {
  if (category === undefined) return { kind: "all" };
  if (category === "uncategorised") return { kind: "uncategorised" };
  return unspecified ? { kind: "unspecified", id: category } : { kind: "category", id: category };
}

function counterpartyScope({ counterparty }: ScopeSearch): CounterpartyScope {
  if (counterparty === undefined) return { kind: "all" };
  if (counterparty === "unidentified") return { kind: "unidentified" };
  return { kind: "counterparty", id: counterparty };
}

export function searchScope(search: ScopeSearch): Scope {
  return { category: categoryScope(search), counterparty: counterpartyScope(search) };
}

// The address of a scope, the inverse of `searchScope`.
export function scopeSearch({ category, counterparty }: Scope) {
  const search: Types.Mutable<ScopeSearch> = {};
  if (category.kind === "uncategorised") search.category = "uncategorised";
  if (category.kind === "category" || category.kind === "unspecified")
    search.category = category.id;
  if (category.kind === "unspecified") search.unspecified = true;
  if (counterparty.kind === "unidentified") search.counterparty = "unidentified";
  if (counterparty.kind === "counterparty") search.counterparty = counterparty.id;
  return search;
}

import { CategoryId, CounterpartyId, TagId } from "@repo/contracts/finance";
import { defaultParseSearch } from "@tanstack/react-router";
import { Result, Schema } from "effect";
import { expect, test } from "vitest";

import { narrowingOf, SpendingSearch, spendingSearch } from "@/features/spending/search";
import { searchScope } from "@/lib/scope";

const food = CategoryId.make("00000000-0000-4000-8000-00000000000f");
const dinnerPlace = CounterpartyId.make("00000000-0000-4000-8000-0000000000d1");
const holiday = TagId.make("00000000-0000-4000-8000-0000000000a1");
const decode = (address: string) =>
  Schema.decodeResult(SpendingSearch)(defaultParseSearch(address));

test("every spending address opens its scope and a link to that scope writes the same address", () => {
  const cases = [
    { address: "", scope: { category: { kind: "all" }, counterparty: { kind: "all" } } },
    {
      address: `?category=${food}`,
      scope: { category: { kind: "category", id: food }, counterparty: { kind: "all" } },
    },
    {
      address: `?category=${food}&unspecified=true`,
      scope: { category: { kind: "unspecified", id: food }, counterparty: { kind: "all" } },
    },
    {
      address: "?category=uncategorised&counterparty=unidentified",
      scope: { category: { kind: "uncategorised" }, counterparty: { kind: "unidentified" } },
    },
    {
      address: `?counterparty=${dinnerPlace}&tag=${holiday}`,
      scope: {
        category: { kind: "all" },
        counterparty: { kind: "counterparty", id: dinnerPlace },
      },
    },
  ];
  for (const { address, scope } of cases) {
    const search = Result.getOrThrow(decode(address));
    expect(searchScope(search)).toEqual(scope);
    expect(spendingSearch(searchScope(search), narrowingOf(search))).toEqual(search);
  }
});

test("an address cannot narrow to what sits on a category without naming the category", () => {
  expect(decode("?unspecified=true")).toMatchObject({ _tag: "Failure" });
  expect(decode("?category=uncategorised&unspecified=true")).toMatchObject({ _tag: "Failure" });
});

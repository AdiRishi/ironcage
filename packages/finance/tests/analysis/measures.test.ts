import { describe, expect, it } from "@effect/vitest";
import { CategoryId } from "@repo/contracts/finance";

import { inCategoryScope } from "../../src/index.ts";

const id = (n: number) => CategoryId.make(`10000000-0000-4000-8000-${String(n).padStart(12, "0")}`);
const food = id(1);
const diningOut = id(2);
const cafes = id(3);
const housing = id(4);
const parents = new Map([
  [food, null],
  [diningOut, food],
  [cafes, diningOut],
  [housing, null],
]);
const placements = [food, diningOut, cafes, housing, null];

describe("inCategoryScope", () => {
  it("opens a category with everything below it, and its unspecified part with only what sits on it", () => {
    expect(
      placements.map((placed) => inCategoryScope({ kind: "category", id: food }, placed, parents)),
    ).toEqual([true, true, true, false, false]);
    expect(
      placements.map((placed) =>
        inCategoryScope({ kind: "unspecified", id: food }, placed, parents),
      ),
    ).toEqual([true, false, false, false, false]);
    expect(
      placements.map((placed) => inCategoryScope({ kind: "uncategorised" }, placed, parents)),
    ).toEqual([false, false, false, false, true]);
  });
});

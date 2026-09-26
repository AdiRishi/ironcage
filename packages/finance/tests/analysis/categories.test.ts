import { expect, it } from "@effect/vitest";
import { CategoryId } from "@repo/contracts/finance";

import { categoryPath, rollupKeys } from "../../src/index.ts";

const id = (n: number) => CategoryId.make(`10000000-0000-4000-8000-${String(n).padStart(12, "0")}`);
const food = id(1);
const diningOut = id(2);
const cafes = id(3);
const groceries = id(4);
const housing = id(5);
const rent = id(6);
const nodes = [
  { id: food, parentId: null },
  { id: diningOut, parentId: food },
  { id: cafes, parentId: diningOut },
  { id: groceries, parentId: food },
  { id: housing, parentId: null },
  { id: rent, parentId: housing },
];

it("rolls a grandchild up to the child of the open category, which keeps its own row", () => {
  expect(rollupKeys(nodes, food)).toEqual(
    new Map([
      [food, food],
      [diningOut, diningOut],
      [cafes, diningOut],
      [groceries, groceries],
    ]),
  );
});

it("rolls every category up to its top-level category when none is open", () => {
  expect(rollupKeys(nodes, null)).toEqual(
    new Map([
      [food, food],
      [diningOut, food],
      [cafes, food],
      [groceries, food],
      [housing, housing],
      [rent, housing],
    ]),
  );
});

it("runs a category's path from its top-level category down to it", () => {
  expect(categoryPath(nodes, cafes).map((node) => node.id)).toEqual([food, diningOut, cafes]);
  expect(categoryPath(nodes, id(99))).toEqual([]);
});

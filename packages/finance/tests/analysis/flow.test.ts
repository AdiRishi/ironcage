import { describe, expect, it } from "@effect/vitest";
import { CategoryId } from "@repo/contracts/finance";

import { largestChanges, summarizeFlow, type CategoryNode, type FlowRow } from "../../src/index.ts";

const id = (n: number) => CategoryId.make(`10000000-0000-4000-8000-${String(n).padStart(12, "0")}`);
const housing = id(1);
const interest = id(2);
const food = id(3);
const delivery = id(4);
const salary = id(5);
const bonus = id(6);
const categories: CategoryNode[] = [
  { id: housing, parentId: null, name: "Housing", slug: "housing", tree: "spending", position: 0 },
  {
    id: interest,
    parentId: housing,
    name: "Mortgage interest",
    slug: "housing.mortgage-interest",
    tree: "spending",
    position: 1,
  },
  { id: food, parentId: null, name: "Food", slug: "food", tree: "spending", position: 2 },
  {
    id: delivery,
    parentId: food,
    name: "Delivery",
    slug: "food.delivery",
    tree: "spending",
    position: 2,
  },
  {
    id: salary,
    parentId: null,
    name: "Salary",
    slug: "income-salary",
    tree: "income",
    position: 0,
  },
  { id: bonus, parentId: salary, name: "Bonus", slug: null, tree: "income", position: 0 },
];
const row = (fields: Partial<FlowRow> & Pick<FlowRow, "measure">): FlowRow => ({
  categoryId: null,
  loanAccount: false,
  current: 0n,
  previous: 0n,
  modelCurrent: 0n,
  purchases: 0,
  previousPurchases: 0,
  ...fields,
});

describe("summarizeFlow", () => {
  it("counts cash out once: interest as housing spending, the rest of the repayment as principal", () => {
    const flow = summarizeFlow({
      currency: "AUD",
      categories,
      rows: [
        row({ measure: "income", categoryId: salary, current: 850000n }),
        row({ measure: "spending", categoryId: interest, loanAccount: true, current: 280000n }),
        row({ measure: "spending", categoryId: delivery, current: 30000n, modelCurrent: 30000n }),
        row({ measure: "loanRepayment", current: 390000n }),
        row({ measure: "internal", current: 200000n }),
      ],
    });
    expect(flow.totals).toMatchObject({
      inflow: { minor: 850000n },
      spending: { minor: 310000n },
      outflow: { minor: 420000n },
      internal: { minor: 200000n },
    });
    expect(flow.outflows.map((stream) => [stream.label, stream.amount.minor])).toEqual([
      ["Housing", 280000n],
      ["Food", 30000n],
      ["Loan principal", 110000n],
    ]);
    expect(flow.modelShare.minor).toBe(30000n);
  });

  it("draws no principal when loan interest exceeds the repayments", () => {
    const flow = summarizeFlow({
      currency: "AUD",
      categories,
      rows: [
        row({ measure: "spending", categoryId: interest, loanAccount: true, current: 5000n }),
        row({ measure: "loanRepayment", current: 3000n }),
      ],
    });
    expect(flow.outflows.map((stream) => [stream.label, stream.amount.minor])).toEqual([
      ["Housing", 5000n],
    ]);
    expect(flow.totals.outflow.minor).toBe(5000n);
  });

  it("keeps an income subcategory inside its top-level stream, and names income with no category", () => {
    const flow = summarizeFlow({
      currency: "AUD",
      categories,
      rows: [
        row({ measure: "income", categoryId: salary, current: 850000n }),
        row({ measure: "income", categoryId: bonus, current: 100000n }),
        row({ measure: "income", current: 20000n }),
      ],
    });
    expect(flow.inflows.map((stream) => [stream.label, stream.amount.minor])).toEqual([
      ["Salary", 950000n],
      ["Not yet categorised", 20000n],
    ]);
    expect(flow.inflows.map((stream) => stream.scope.category)).toEqual([
      { kind: "category", id: salary },
      { kind: "uncategorised" },
    ]);
  });
});

describe("largestChanges", () => {
  it("explains a change by more purchases and a higher average", () => {
    const [change] = largestChanges({
      currency: "AUD",
      categories,
      limit: 3,
      rows: [
        row({
          measure: "spending",
          categoryId: delivery,
          current: 30000n,
          previous: 20000n,
          purchases: 12,
          previousPurchases: 10,
        }),
      ],
    });
    expect(change).toMatchObject({
      label: "Delivery",
      parentLabel: "Food",
      purchasesPart: { minor: 4500n },
      averagePart: { minor: 5500n },
    });
  });
});

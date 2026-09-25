import { describe, expect, it } from "@effect/vitest";
import { CategoryId, CounterpartyId, type CategoryTree } from "@repo/contracts/finance";

import { personProposal, type ModelDefaults, type ReferenceAnswer } from "../src/index.ts";

const id = (prefix: string, n: number) => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const category = (n: number, name: string, tree: CategoryTree) => ({
  id: CategoryId.make(id("60000000", n)),
  name,
  tree,
});
const housing = category(1, "Housing", "spending");
const rent = category(2, "Rent", "spending");
const groceries = category(3, "Groceries", "spending");
const salary = category(4, "Salary", "income");
const governmentSpending = category(5, "Government", "spending");
const governmentIncome = category(6, "Government", "income");
const rentalIncome = category(7, "Rental income", "income");
const categories = [
  housing,
  rent,
  groceries,
  salary,
  governmentSpending,
  governmentIncome,
  rentalIncome,
];
const sam = CounterpartyId.make(id("50000000", 1));
const alex = CounterpartyId.make(id("50000000", 2));
const answer = (fields: Partial<ReferenceAnswer>): ReferenceAnswer => ({
  counterpartyId: sam,
  counterpartyName: "Sam Lee",
  defaultRole: "purchase",
  defaultCategoryId: rent.id,
  ...fields,
});
const model = (fields: Partial<ModelDefaults>): ModelDefaults => ({
  role: "reimbursement",
  categoryId: null,
  confidence: 0.7,
  reason: "Transfers between two people",
  ...fields,
});
const propose = ({
  direction = "out",
  referenceKey = "rent",
  answers = [],
  defaults = null,
}: {
  direction?: "out" | "in";
  referenceKey?: string | null;
  answers?: ReferenceAnswer[];
  defaults?: ModelDefaults | null;
}) => personProposal({ direction, referenceKey, answers, categories, model: defaults });

describe("personProposal", () => {
  it("proposes your earlier answer for the same reference ahead of the reference text and the model", () => {
    expect(propose({ answers: [answer({})], defaults: model({}) })).toEqual({
      role: "purchase",
      categoryId: rent.id,
      basis: { kind: "answer", counterpartyId: sam, counterpartyName: "Sam Lee" },
    });
  });

  it("leaves earlier answers that disagree to the reference text", () => {
    const answers = [
      answer({}),
      answer({ counterpartyId: alex, counterpartyName: "Alex Wu", defaultCategoryId: housing.id }),
    ];
    expect(propose({ answers })).toEqual({
      role: "purchase",
      categoryId: rent.id,
      basis: { kind: "reference" },
    });
  });

  it("proposes the one category a reference names, in the role its direction allows", () => {
    const reference = { kind: "reference" };
    expect(propose({ direction: "out" })).toEqual({
      role: "purchase",
      categoryId: rent.id,
      basis: reference,
    });
    expect(propose({ direction: "in" })).toEqual({
      role: "reimbursement",
      categoryId: rent.id,
      basis: reference,
    });
    expect(propose({ direction: "in", referenceKey: "salary" })).toEqual({
      role: "income",
      categoryId: salary.id,
      basis: reference,
    });
    expect(propose({ direction: "out", referenceKey: "salary" })).toBeNull();
  });

  it("proposes nothing when the reference names two categories the payments could take", () => {
    expect(propose({ direction: "out", referenceKey: "government" })).toEqual({
      role: "purchase",
      categoryId: governmentSpending.id,
      basis: { kind: "reference" },
    });
    expect(propose({ direction: "in", referenceKey: "government" })).toBeNull();
  });

  it("falls back to the model's role with its confidence and reason, when it gave one", () => {
    expect(
      propose({
        direction: "in",
        referenceKey: "dinner split",
        defaults: model({ categoryId: groceries.id }),
      }),
    ).toEqual({
      role: "reimbursement",
      categoryId: groceries.id,
      basis: { kind: "model", confidence: 0.7, reason: "Transfers between two people" },
    });
    expect(propose({ referenceKey: null, defaults: model({ role: null }) })).toBeNull();
  });

  it("never proposes a category outside the proposed role's tree", () => {
    expect(
      propose({
        direction: "in",
        answers: [answer({ defaultRole: "income", defaultCategoryId: groceries.id })],
      }),
    ).toEqual({
      role: "income",
      categoryId: null,
      basis: { kind: "answer", counterpartyId: sam, counterpartyName: "Sam Lee" },
    });
    expect(
      propose({
        direction: "in",
        referenceKey: null,
        defaults: model({ categoryId: salary.id }),
      }),
    ).toEqual({
      role: "reimbursement",
      categoryId: null,
      basis: { kind: "model", confidence: 0.7, reason: "Transfers between two people" },
    });
  });

  it("proposes an earlier answer or the model's role only as the payments' direction allows", () => {
    const flatmate = answer({ defaultRole: "income", defaultCategoryId: rentalIncome.id });
    expect(propose({ direction: "out", answers: [flatmate] })).toEqual({
      role: "purchase",
      categoryId: rent.id,
      basis: { kind: "reference" },
    });
    expect(propose({ direction: "in", answers: [answer({})] })).toEqual({
      role: "reimbursement",
      categoryId: rent.id,
      basis: { kind: "answer", counterpartyId: sam, counterpartyName: "Sam Lee" },
    });
    expect(
      propose({ referenceKey: "dinner split", defaults: model({ categoryId: groceries.id }) }),
    ).toEqual({
      role: "purchase",
      categoryId: groceries.id,
      basis: { kind: "model", confidence: 0.7, reason: "Transfers between two people" },
    });
  });

  it("never proposes that a person is a transfer", () => {
    expect(
      propose({
        referenceKey: "savings",
        answers: [answer({ defaultRole: "transfer", defaultCategoryId: null })],
        defaults: model({ role: "transfer" }),
      }),
    ).toBeNull();
  });
});

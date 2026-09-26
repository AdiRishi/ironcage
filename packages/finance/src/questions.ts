import {
  type CategoryId,
  type CategoryTree,
  type CounterpartyId,
  type CounterpartyRole,
  FinancialRole,
  type FlowDirection,
  type Money,
  type PersonRole,
  type RoleProposal,
} from "@repo/contracts/finance";

import { referenceKey } from "./descriptors/commbank.ts";
import { categoryTreeForRole } from "./interpretation.ts";

// A transaction whose role you set in one of these takes no category, so no answer to a
// question can change it.
export const rolesWithoutCategory = FinancialRole.literals.filter(
  (role) => categoryTreeForRole(role) === null,
);

// The money questions affect, whichever way it moved. Questions are ranked by it.
export function affectedMoney({ outflow, inflow }: { outflow: Money; inflow: Money }) {
  return { currency: outflow.currency, minor: outflow.minor + inflow.minor };
}

// A default you set for the same reference key on another counterparty.
export type ReferenceAnswer = {
  counterpartyId: typeof CounterpartyId.Type;
  counterpartyName: string;
  defaultRole: typeof CounterpartyRole.Type;
  defaultCategoryId: typeof CategoryId.Type | null;
};
export type ProposalCategory = {
  id: typeof CategoryId.Type;
  name: string;
  tree: CategoryTree;
};
// The defaults the model proposed with a person counterparty.
export type ModelDefaults = {
  role: typeof CounterpartyRole.Type | null;
  categoryId: typeof CategoryId.Type | null;
  confidence: number;
  reason: string;
};

// What payments with a person that carry one reference key are proposed to be, from the
// first of: your defaults for the key on other counterparties when they agree, the one
// category the key names, and the model's role. Every proposal takes the role that the
// payments' direction allows in its category tree, so an answer about rent you receive
// proposes nothing for rent you pay, and a person is never proposed a transfer.
export function personProposal({
  direction,
  referenceKey: key,
  answers,
  categories,
  model,
}: {
  direction: FlowDirection;
  referenceKey: string | null;
  answers: readonly ReferenceAnswer[];
  categories: readonly ProposalCategory[];
  model: ModelDefaults | null;
}): RoleProposal | null {
  // A default's role for these payments, with its category when that is in the role's tree.
  const directed = (
    defaultRole: typeof CounterpartyRole.Type,
    categoryId: typeof CategoryId.Type | null,
  ) => {
    const tree = categoryTreeForRole(defaultRole);
    const role = tree && roleForTree(direction, tree);
    if (!role) return null;
    const fits = categories.some(
      (category) => category.id === categoryId && category.tree === tree,
    );
    return { role, categoryId: fits ? categoryId : null };
  };

  const fitting = answers.flatMap((answer) => {
    const proposal = directed(answer.defaultRole, answer.defaultCategoryId);
    return proposal ? [{ ...proposal, answer }] : [];
  });
  const [agreed, ...others] = fitting;
  if (
    agreed &&
    others.every((other) => other.role === agreed.role && other.categoryId === agreed.categoryId)
  )
    return {
      role: agreed.role,
      categoryId: agreed.categoryId,
      basis: {
        kind: "answer",
        counterpartyId: agreed.answer.counterpartyId,
        counterpartyName: agreed.answer.counterpartyName,
      },
    };

  const named = categories.flatMap((category) => {
    const role = roleForTree(direction, category.tree);
    return role && key !== null && referenceKey(category.name) === key
      ? [{ role, categoryId: category.id }]
      : [];
  });
  const [only, ...more] = named;
  if (only && more.length === 0) return { ...only, basis: { kind: "reference" } };

  const modelled = model?.role ? directed(model.role, model.categoryId) : null;
  if (model && modelled)
    return {
      ...modelled,
      basis: { kind: "model", confidence: model.confidence, reason: model.reason },
    };
  return null;
}

// Payments out are spending. Payments in are income, or someone paying you back for
// spending.
function roleForTree(direction: FlowDirection, tree: CategoryTree): PersonRole | null {
  if (tree === "income") return direction === "in" ? "income" : null;
  return direction === "out" ? "purchase" : "reimbursement";
}

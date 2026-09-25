import type {
  AccountId,
  AccountKind,
  CategoryId,
  CategorySource,
  CategoryTree,
  CounterpartyId,
  CounterpartyKind,
  CounterpartyRole,
  Descriptor,
  FinancialEvent,
  FinancialRole,
  RoleSource,
  Rule,
} from "@repo/contracts/finance";

export type OwnedAccount = {
  id: typeof AccountId.Type;
  kind: typeof AccountKind.Type;
  suffix: string | null;
};

export type BankReading = {
  role: FinancialRole | null;
  categorySlug: string | null;
};

// What the bank's own structure establishes, independent of who the counterparty is.
export function bankReading({
  descriptor,
  description,
  amountMinor,
  accountKind,
  ownedAccounts,
}: {
  descriptor: Descriptor;
  description: string;
  amountMinor: bigint;
  accountKind: typeof AccountKind.Type;
  ownedAccounts: readonly OwnedAccount[];
}): BankReading {
  const debit = amountMinor < 0n;
  const read = (role: FinancialRole | null, categorySlug: string | null = null) => ({
    role,
    categorySlug,
  });
  if (descriptor.ownAccountSuffix) {
    const owned = ownedAccounts.find((account) => account.suffix === descriptor.ownAccountSuffix);
    if (!owned) return read(null);
    if (owned.kind === "card") return read(debit ? "cardSettlement" : "transfer");
    if (owned.kind === "loan") return read(debit ? "loanPayment" : "borrowing");
    return read("transfer");
  }
  switch (descriptor.channel) {
    case "interest":
      return debit
        ? read(
            "financingCost",
            accountKind === "loan"
              ? "housing.mortgage-interest"
              : accountKind === "card"
                ? "fees-and-interest.card-interest"
                : "fees-and-interest.bank-fees",
          )
        : read("income", "income-interest");
    case "fee": {
      const slug = /International Transaction Fee/i.test(description)
        ? "fees-and-interest.foreign-transaction-fees"
        : "fees-and-interest.bank-fees";
      return read(debit ? "financingCost" : "refund", slug);
    }
    case "loan":
      return accountKind === "loan"
        ? read(debit ? "borrowing" : "loanPayment")
        : read(debit ? "loanPayment" : "borrowing");
    case "cardPayment":
      return read("cardSettlement");
    case "card":
    case "directDebit":
    case "bpay":
      return read(debit ? "purchase" : "refund");
    case "cash":
      return debit ? read("purchase", "cash.withdrawals") : read(null);
    case "salary":
      return debit ? read(null) : read("income", "income-salary");
    case "transfer":
    case "directCredit":
    case "other":
      return accountKind === "card" && debit ? read("purchase") : read(null);
  }
}

export type CounterpartyDefaults = {
  id: typeof CounterpartyId.Type;
  kind: CounterpartyKind;
  defaultRole: typeof CounterpartyRole.Type | null;
  defaultCategoryId: typeof CategoryId.Type | null;
  applied: boolean;
};

// Only people and institutions take a default role. A business and an own account decide
// by their kind.
export function takesDefaultRole(kind: CounterpartyKind) {
  return kind === "person" || kind === "institution";
}

export function counterpartyRole(
  counterparty: CounterpartyDefaults,
  amountMinor: bigint,
): FinancialRole | null {
  const debit = amountMinor < 0n;
  if (counterparty.kind === "ownAccount") return "transfer";
  switch (counterparty.defaultRole) {
    case "transfer":
      return "transfer";
    case "purchase":
      return debit ? "purchase" : "refund";
    case "income":
    case "refund":
    case "reimbursement":
      return debit ? "purchase" : counterparty.defaultRole;
    case null:
      if (counterparty.kind === "business") return debit ? "purchase" : "refund";
      if (counterparty.kind === "institution") return debit ? "purchase" : "income";
      return null;
  }
}

export function categoryTreeForRole(role: FinancialRole): CategoryTree | null {
  switch (role) {
    case "purchase":
    case "financingCost":
    case "refund":
    case "reimbursement":
      return "spending";
    case "income":
      return "income";
    case "transfer":
    case "cardSettlement":
    case "borrowing":
    case "loanPayment":
    case "unresolved":
      return null;
  }
}

export type RuleActions = {
  role: FinancialRole | null;
  categoryId: typeof CategoryId.Type | null;
  roleConflict: boolean;
  categoryConflict: boolean;
};

export function ruleActions(rules: readonly Rule[]): RuleActions {
  const roles = new Set(
    rules.flatMap((rule) => (rule.action.kind === "role" ? [rule.action.role] : [])),
  );
  const categories = new Set(
    rules.flatMap((rule) => (rule.action.kind === "category" ? [rule.action.categoryId] : [])),
  );
  const [role] = roles;
  const [categoryId] = categories;
  return {
    role: roles.size === 1 && role ? role : null,
    categoryId: categories.size === 1 && categoryId ? categoryId : null,
    roleConflict: roles.size > 1,
    categoryConflict: categories.size > 1,
  };
}

// The rules that disagree about a value they would set. A disagreement over a value you
// fixed does not matter, so it names no rules.
export function conflictingRules({
  rules,
  roleLocked,
  categoryLocked,
}: {
  rules: readonly Rule[];
  roleLocked: boolean;
  categoryLocked: boolean;
}) {
  const actions = ruleActions(rules);
  return rules.filter((rule) =>
    rule.action.kind === "role"
      ? actions.roleConflict && !roleLocked
      : actions.categoryConflict && !categoryLocked,
  );
}

export type Derivation = {
  kind: FinancialRole;
  roleSource: RoleSource | null;
  counterpartyId: typeof CounterpartyId.Type | null;
  counterpartySource: "user" | "alias" | null;
  categoryId: typeof CategoryId.Type | null;
  categorySource: CategorySource | null;
};

// Applies the precedence in the interpretation reference to one event. Values you
// set are kept; everything else is recomputed from rules, bank structure, and the
// counterparty. Linked movements and splits keep their role and allocations, and so
// does any event whose role an accepted credit link or fee association relies on.
export function deriveInterpretation({
  event,
  roleLocked = false,
  amountMinor,
  bank,
  aliasCounterpartyId,
  counterparty,
  rules,
  categoryTree,
  categoryIdForSlug,
}: {
  event: Pick<FinancialEvent, "kind" | "roleSource" | "counterpartyId" | "counterpartySource"> & {
    allocations: readonly Pick<
      FinancialEvent["allocations"][number],
      "categoryId" | "categorySource"
    >[];
  };
  roleLocked?: boolean;
  amountMinor: bigint;
  bank: BankReading;
  aliasCounterpartyId: typeof CounterpartyId.Type | null;
  counterparty: CounterpartyDefaults | null;
  rules: RuleActions;
  categoryTree: (id: typeof CategoryId.Type) => CategoryTree | null;
  categoryIdForSlug: (slug: string) => typeof CategoryId.Type | null;
}): Derivation {
  const counterpartyId =
    event.counterpartySource === "user" ? event.counterpartyId : aliasCounterpartyId;
  const counterpartySource =
    event.counterpartySource === "user" ? "user" : aliasCounterpartyId ? "alias" : null;
  const applied = counterparty?.applied ? counterparty : null;

  const role = chooseRole({ event, roleLocked, rules, bank, applied, amountMinor });
  const category = chooseCategory({
    allocations: event.allocations,
    tree: categoryTreeForRole(role.kind),
    rules,
    applied,
    bank,
    categoryTree,
    categoryIdForSlug,
  });

  return {
    kind: role.kind,
    roleSource: role.source,
    counterpartyId,
    counterpartySource,
    categoryId: category.id,
    categorySource: category.source,
  };
}

type RoleChoice = { kind: FinancialRole; source: RoleSource | null };

function chooseRole({
  event,
  roleLocked,
  rules,
  bank,
  applied,
  amountMinor,
}: {
  event: Pick<FinancialEvent, "kind" | "roleSource">;
  roleLocked: boolean;
  rules: RuleActions;
  bank: BankReading;
  applied: CounterpartyDefaults | null;
  amountMinor: bigint;
}): RoleChoice {
  if (roleLocked || event.roleSource === "user" || event.roleSource === "link")
    return { kind: event.kind, source: event.roleSource };
  if (rules.role) return { kind: rules.role, source: "rule" };
  if (bank.role) return { kind: bank.role, source: "bank" };
  const fromCounterparty = applied ? counterpartyRole(applied, amountMinor) : null;
  if (fromCounterparty) return { kind: fromCounterparty, source: "counterparty" };
  return { kind: "unresolved", source: null };
}

type CategoryChoice = { id: typeof CategoryId.Type | null; source: CategorySource | null };

function chooseCategory({
  allocations,
  tree,
  rules,
  applied,
  bank,
  categoryTree,
  categoryIdForSlug,
}: {
  allocations: readonly Pick<
    FinancialEvent["allocations"][number],
    "categoryId" | "categorySource"
  >[];
  tree: CategoryTree | null;
  rules: RuleActions;
  applied: CounterpartyDefaults | null;
  bank: BankReading;
  categoryTree: (id: typeof CategoryId.Type) => CategoryTree | null;
  categoryIdForSlug: (slug: string) => typeof CategoryId.Type | null;
}): CategoryChoice {
  const [allocation] = allocations;
  if (allocations.length > 1 || allocation?.categorySource === "user")
    return { id: allocation?.categoryId ?? null, source: allocation?.categorySource ?? null };
  if (tree === null) return { id: null, source: null };
  const fits = (id: typeof CategoryId.Type | null) => id !== null && categoryTree(id) === tree;
  if (fits(rules.categoryId)) return { id: rules.categoryId, source: "rule" };
  if (applied && fits(applied.defaultCategoryId))
    return { id: applied.defaultCategoryId, source: "counterparty" };
  const bankCategory = bank.categorySlug ? categoryIdForSlug(bank.categorySlug) : null;
  if (fits(bankCategory)) return { id: bankCategory, source: "bank" };
  return { id: null, source: null };
}

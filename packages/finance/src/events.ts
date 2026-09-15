import type { AccountKind, AllocationRole, FinancialRole } from "@repo/contracts/finance";

export const financialRoleLabels = {
  purchase: "Purchase",
  income: "Income",
  transfer: "Transfer",
  cardSettlement: "Card settlement",
  borrowing: "Borrowing",
  loanPayment: "Loan payment",
  refund: "Refund",
  reimbursement: "Reimbursement",
  financingCost: "Interest or fee",
  unresolved: "Unresolved",
} satisfies Record<FinancialRole, string>;

export function sourceRole({
  description,
  minor,
  accountKind,
}: {
  description: string;
  minor: bigint;
  accountKind: typeof AccountKind.Type;
}): FinancialRole {
  if (minor < 0n && (/^Interest\b/i.test(description) || /\bFee\b/i.test(description)))
    return "financingCost";
  if (minor < 0n && /Card xx/i.test(description)) return "purchase";
  if (accountKind === "deposit" && /^Transfer (to|from)\b/i.test(description)) return "transfer";
  if (accountKind === "loan" && minor > 0n && /Repayment\/Payment/i.test(description))
    return "loanPayment";
  if (accountKind === "loan" && minor < 0n && /Money we lent you/i.test(description))
    return "borrowing";
  if (accountKind === "card" && minor > 0n && /^Payment\b/i.test(description))
    return "cardSettlement";
  return "unresolved";
}
export function allocationRole(kind: FinancialRole): typeof AllocationRole.Type {
  return kind === "cardSettlement" || kind === "loanPayment" ? "transfer" : kind;
}

export function isCost(role: typeof AllocationRole.Type) {
  return role === "purchase" || role === "financingCost";
}

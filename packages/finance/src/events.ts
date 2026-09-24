import type { AllocationRole, FinancialRole } from "@repo/contracts/finance";

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

export function allocationRole(kind: FinancialRole): typeof AllocationRole.Type {
  return kind === "cardSettlement" || kind === "loanPayment" ? "transfer" : kind;
}

export function isCost(role: typeof AllocationRole.Type) {
  return role === "purchase" || role === "financingCost";
}

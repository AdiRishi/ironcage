import type { Account } from "@repo/contracts/finance";

export const accountKindLabels: Record<Account["kind"], string> = {
  deposit: "Deposit",
  card: "Credit card",
  loan: "Loan",
};

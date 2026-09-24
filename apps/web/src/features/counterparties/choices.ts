import type { CounterpartyKind, CounterpartyRole } from "@repo/contracts/finance";

export const counterpartyKinds: ReadonlyArray<{ value: CounterpartyKind; label: string }> = [
  { value: "business", label: "A business" },
  { value: "person", label: "A person" },
  { value: "institution", label: "An institution" },
  { value: "ownAccount", label: "My own account elsewhere" },
];

// What money to or from a person or institution usually is. No default means each
// payment's direction decides.
export const counterpartyRoles: ReadonlyArray<{
  value: typeof CounterpartyRole.Type;
  label: string;
}> = [
  { value: "purchase", label: "Spending, such as rent or a bill" },
  { value: "reimbursement", label: "Paying me back" },
  { value: "income", label: "Income" },
  { value: "transfer", label: "Moving my own money" },
];

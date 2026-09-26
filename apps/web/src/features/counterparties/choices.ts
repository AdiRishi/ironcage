import { type CounterpartyKind, type CounterpartyRole, PersonRole } from "@repo/contracts/finance";
import { takesDefaultRole } from "@repo/finance";
import { Schema } from "effect";

export const counterpartyKinds: ReadonlyArray<{ value: CounterpartyKind; label: string }> = [
  { value: "business", label: "A business" },
  { value: "person", label: "A person" },
  { value: "institution", label: "An institution" },
  { value: "ownAccount", label: "My own account elsewhere" },
];
// A kind as a column or list names it.
export const kindLabels = {
  business: "Business",
  person: "Person",
  ownAccount: "Your account",
  institution: "Institution",
} satisfies Record<CounterpartyKind, string>;

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
// The roles a person's payments can take. Your own money at another bank is an own
// account, not a person.
export const personRoles = counterpartyRoles.flatMap((role) =>
  Schema.is(PersonRole)(role.value) ? [{ value: role.value, label: role.label }] : [],
);
export const rolesFor = (kind: CounterpartyKind) =>
  kind === "person" ? personRoles : counterpartyRoles;
// The default role a counterparty of `kind` keeps from `role`. A form holds on to a role
// while you try other kinds, and a kind that takes no role, or not that one, drops it.
export const kindRole = (kind: CounterpartyKind, role: typeof CounterpartyRole.Type | null) =>
  takesDefaultRole(kind) && rolesFor(kind).some((item) => item.value === role) ? role : null;

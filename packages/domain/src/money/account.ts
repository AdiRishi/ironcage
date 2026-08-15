import { Schema } from "effect";

/**
 * The internal shape of an owned bank account. `deposit` covers both offsets,
 * `credit_card` the Mastercard, `credit_line` the home loan. The type decides
 * which structured evidence a profile demands — balances, identifier policy,
 * sign expectations — never how a stored sign is rewritten.
 */
export const BankAccountType = Schema.Literals(["deposit", "credit_card", "credit_line"]);
export type BankAccountType = typeof BankAccountType.Type;

import { Schema } from "effect";

import { Aud } from "../values/decimal";
import { BankAccountId, CategoryId } from "./ids";

export const CategoryKind = Schema.Literals(["expense", "income"]);
export type CategoryKind = typeof CategoryKind.Type;

/**
 * The system-owned initial category. Seeded by migration under a fixed UUID so
 * code can name it without a lookup; it cannot be renamed or deleted.
 */
export const uncategorizedCategoryId = Schema.decodeUnknownSync(CategoryId)(
  "01900000-0000-7000-8000-000000000001",
);

export const SplitProvenance = Schema.Literals(["system", "rule", "ai", "manual"]);
export type SplitProvenance = typeof SplitProvenance.Type;

/**
 * A rule's stored predicate. Present conditions AND together; a rule with no
 * conditions is invalid at the boundary rather than a match-everything trap.
 */
export const RulePredicate = Schema.Struct({
  payeeEquals: Schema.optionalKey(Schema.String),
  narrativeContains: Schema.optionalKey(Schema.Array(Schema.String)),
  accountId: Schema.optionalKey(BankAccountId),
  direction: Schema.optionalKey(Schema.Literals(["debit", "credit"])),
  minAbsoluteAmount: Schema.optionalKey(Aud),
  maxAbsoluteAmount: Schema.optionalKey(Aud),
}).check(
  Schema.makeFilter((predicate: object) => Object.keys(predicate).length > 0, {
    expected: "a predicate with at least one condition",
  }),
);
export type RulePredicate = typeof RulePredicate.Type;

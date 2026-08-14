import { Schema } from "effect";

/**
 * A stored decision about a candidate pairing. Unresolved candidates are
 * computed from the record rather than stored, so a transaction can hold at
 * most one confirmed match while dismissals accumulate freely.
 */
export const TransferMatchStatus = Schema.Literals(["confirmed", "dismissed"]);
export type TransferMatchStatus = typeof TransferMatchStatus.Type;

/**
 * What confirmed a match: the only possible one-to-one pairing in the window,
 * a normalized bank reference agreeing on both legs, or the operator.
 */
export const TransferMatchMethod = Schema.Literals(["sole_pairing", "reference", "operator"]);
export type TransferMatchMethod = typeof TransferMatchMethod.Type;

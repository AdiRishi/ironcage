import { Schema } from "effect";

export const TransferMatchStatus = Schema.Literals(["proposed", "confirmed", "dismissed"]);
export type TransferMatchStatus = typeof TransferMatchStatus.Type;

/**
 * What confirmed a match: the only possible one-to-one pairing in the window,
 * a normalized bank reference agreeing on both legs, or the operator.
 */
export const TransferMatchMethod = Schema.Literals(["sole_pairing", "reference", "operator"]);
export type TransferMatchMethod = typeof TransferMatchMethod.Type;

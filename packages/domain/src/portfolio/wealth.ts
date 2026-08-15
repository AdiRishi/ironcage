import { Schema } from "effect";

import { uuidV7 } from "../values/uuid";

export const ExternalAccountId = uuidV7("ExternalAccountId");
export type ExternalAccountId = typeof ExternalAccountId.Type;

export const ExternalBalanceId = uuidV7("ExternalBalanceId");
export type ExternalBalanceId = typeof ExternalBalanceId.Type;

export const WealthKind = Schema.Literals(["asset", "liability"]);
export type WealthKind = typeof WealthKind.Type;

export const SystemMode = Schema.Literals(["running", "halted"]);
export type SystemMode = typeof SystemMode.Type;

export type Moded<A> =
  | { readonly _tag: "DryRun"; readonly value: A }
  | { readonly _tag: "Live"; readonly value: A };

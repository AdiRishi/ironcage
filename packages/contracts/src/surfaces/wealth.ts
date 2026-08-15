import {
  Aud,
  CalendarDate,
  ExternalAccountId,
  Instant,
  RequestId,
  WealthKind,
} from "@ironcage/domain";
import { Schema } from "effect";
import { Rpc as RpcModule } from "effect/unstable/rpc";

import { Observed } from "../values/observed";
import { Conflict, Internal, NotFound, ValidationFailed } from "./errors";

export const WealthPosition = Schema.Struct({
  id: Schema.String,
  source: Schema.Literals(["money", "external"]),
  label: Schema.String,
  kind: WealthKind,
  balanceDate: Schema.NullOr(CalendarDate),
  balance: Observed(Aud),
});
export type WealthPosition = typeof WealthPosition.Type;

export const WholeWealth = Schema.Struct({
  positions: Schema.Array(WealthPosition),
  netWorth: Observed(Aud),
});
export type WholeWealth = typeof WholeWealth.Type;

export const ExternalAccount = Schema.Struct({
  id: ExternalAccountId,
  label: Schema.String,
  kind: WealthKind,
  archived: Schema.Boolean,
  latestBalance: Schema.NullOr(Aud),
  balanceDate: Schema.NullOr(CalendarDate),
  observedAt: Schema.NullOr(Instant),
});
export type ExternalAccount = typeof ExternalAccount.Type;

const MutationError = Schema.Union([ValidationFailed, NotFound, Conflict, Internal]);

export const getWholeWealthRpc = RpcModule.make("getWholeWealth", {
  success: WholeWealth,
  error: Internal,
});

export const listExternalAccountsRpc = RpcModule.make("listExternalAccounts", {
  success: Schema.Array(ExternalAccount),
  error: Internal,
});

export const RecordExternalBalanceInput = Schema.Struct({
  requestId: RequestId,
  accountId: Schema.NullOr(ExternalAccountId),
  label: Schema.String,
  kind: WealthKind,
  balance: Aud,
  balanceDate: CalendarDate,
});

export const recordExternalBalanceRpc = RpcModule.make("recordExternalBalance", {
  payload: RecordExternalBalanceInput.fields,
  success: ExternalAccount,
  error: MutationError,
});

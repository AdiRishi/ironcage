import { Schema } from "effect";

import { AccountId, AccountKind, CommandId, Currency, Institution, Version } from "./values.ts";

export const Account = Schema.Struct({
  id: AccountId,
  kind: AccountKind,
  institution: Institution,
  label: Schema.String,
  currency: Currency,
  bankId: Schema.NullOr(Schema.String),
  accountNumber: Schema.NullOr(Schema.String),
  version: Version,
});
export type Account = typeof Account.Type;
export const CreateAccount = Schema.Struct({
  commandId: CommandId,
  label: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  kind: AccountKind,
  institution: Institution,
  currency: Currency,
});
export const UpdateAccount = Schema.Struct({
  commandId: CommandId,
  accountId: AccountId,
  expectedVersion: Version,
  label: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  kind: AccountKind,
});

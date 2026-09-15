import { Schema } from "effect";

import { AccountId, CalendarDate, CommandId, Version } from "./values.ts";
export const AccountPeriodId = Schema.String.check(Schema.isUUID()).pipe(
  Schema.brand("AccountPeriodId"),
);
const period = {
  id: AccountPeriodId,
  startOn: CalendarDate,
  endOn: Schema.NullOr(CalendarDate),
  version: Version,
};
export const AccountPeriod = Schema.Union([
  Schema.Struct({
    ...period,
    kind: Schema.Literal("label"),
    accountId: AccountId,
    label: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  }),
  Schema.Struct({
    ...period,
    kind: Schema.Literal("offset"),
    accountId: AccountId,
    loanAccountId: AccountId,
  }),
]);
export type AccountPeriod = typeof AccountPeriod.Type;
export const AccountPeriods = Schema.Array(AccountPeriod);
export const SaveAccountPeriod = Schema.Struct({
  commandId: CommandId,
  record: AccountPeriod,
  expectedVersion: Schema.NullOr(Version),
});
export const DeleteAccountPeriod = Schema.Struct({
  commandId: CommandId,
  id: AccountPeriodId,
  kind: Schema.Literals(["label", "offset"]),
  expectedVersion: Version,
});

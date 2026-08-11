import { Schema } from "effect";

import { CalendarDate } from "../values/calendar";
import { Currency } from "../values/decimal";
import { uuidV7 } from "../values/uuid";

export const BankAccountId = uuidV7("BankAccountId");
export type BankAccountId = typeof BankAccountId.Type;

export const BankAccountProfileId = Schema.Literals([
  "spending-offset",
  "savings-offset",
  "mastercard",
  "home-loan",
]);
export type BankAccountProfileId = typeof BankAccountProfileId.Type;

export const BankAccountType = Schema.Literals(["deposit", "credit_card", "credit_line"]);
export type BankAccountType = typeof BankAccountType.Type;

export const BankIdentity = Schema.Union([
  Schema.Struct({
    messageSet: Schema.Literal("bank"),
    bankId: Schema.String.check(Schema.isMinLength(1)),
    accountId: Schema.String.check(Schema.isMinLength(1)),
    accountType: Schema.String.check(Schema.isMinLength(1)),
  }),
  Schema.Struct({
    messageSet: Schema.Literal("credit_card"),
    accountId: Schema.String.check(Schema.isMinLength(1)),
  }),
]);
export type BankIdentity = typeof BankIdentity.Type;

export const BankAccount = Schema.Struct({
  id: BankAccountId,
  profile: BankAccountProfileId,
  label: Schema.String.check(Schema.isMinLength(1)),
  type: BankAccountType,
  maskedSuffix: Schema.String.check(Schema.isPattern(/^\d{4}$/)),
  currency: Currency,
  required: Schema.Boolean,
  effectiveFrom: CalendarDate,
  effectiveTo: Schema.NullOr(CalendarDate),
});
export type BankAccount = typeof BankAccount.Type;

export const RegisterBankAccount = Schema.Struct({
  id: BankAccountId,
  profile: BankAccountProfileId,
  label: Schema.String.check(Schema.isMinLength(1)),
  maskedSuffix: Schema.String.check(Schema.isPattern(/^\d{4}$/)),
  identity: BankIdentity,
  required: Schema.Boolean,
  effectiveFrom: CalendarDate,
});
export type RegisterBankAccount = typeof RegisterBankAccount.Type;

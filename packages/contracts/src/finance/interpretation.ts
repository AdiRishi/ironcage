import { Schema } from "effect";
export const EventId = Schema.String.check(Schema.isUUID()).pipe(Schema.brand("EventId"));
export const AllocationId = Schema.String.check(Schema.isUUID()).pipe(Schema.brand("AllocationId"));
export const CategoryId = Schema.String.check(Schema.isUUID()).pipe(Schema.brand("CategoryId"));
export const MerchantId = Schema.String.check(Schema.isUUID()).pipe(Schema.brand("MerchantId"));
export const TagId = Schema.String.check(Schema.isUUID()).pipe(Schema.brand("TagId"));
export const PersonalEventId = Schema.String.check(Schema.isUUID()).pipe(
  Schema.brand("PersonalEventId"),
);
export const FinancialRole = Schema.Literals([
  "purchase",
  "income",
  "transfer",
  "cardSettlement",
  "borrowing",
  "loanPayment",
  "refund",
  "reimbursement",
  "financingCost",
  "unresolved",
]);
export type FinancialRole = typeof FinancialRole.Type;
export const AllocationRole = Schema.Literals([
  "purchase",
  "income",
  "transfer",
  "borrowing",
  "refund",
  "reimbursement",
  "financingCost",
  "unresolved",
]);
export const InterpretationFilter = Schema.Struct({
  role: Schema.optionalKey(FinancialRole),
  categoryId: Schema.optionalKey(CategoryId),
  merchantId: Schema.optionalKey(MerchantId),
  tagId: Schema.optionalKey(TagId),
  personalEventId: Schema.optionalKey(PersonalEventId),
  interpretationReview: Schema.optionalKey(Schema.Boolean),
});
export const Channel = Schema.Literals([
  "card",
  "transfer",
  "bpay",
  "directDebit",
  "directCredit",
  "salary",
  "cash",
  "interest",
  "fee",
  "loan",
  "cardPayment",
  "other",
]);
export type Channel = typeof Channel.Type;
export const Descriptor = Schema.Struct({
  profileVersion: Schema.Int,
  channel: Channel,
  counterpartyText: Schema.NullOr(Schema.String),
  aliasKey: Schema.NullOr(Schema.String),
  cardSuffix: Schema.NullOr(Schema.String),
  ownAccountSuffix: Schema.NullOr(Schema.String),
  payId: Schema.NullOr(Schema.String),
  reference: Schema.NullOr(Schema.String),
  foreign: Schema.NullOr(Schema.Struct({ currency: Schema.String, amount: Schema.String })),
});
export type Descriptor = typeof Descriptor.Type;

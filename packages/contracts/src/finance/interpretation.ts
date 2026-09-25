import { Schema } from "effect";
export const EventId = Schema.String.check(Schema.isUUID()).pipe(Schema.brand("EventId"));
export const AllocationId = Schema.String.check(Schema.isUUID()).pipe(Schema.brand("AllocationId"));
export const CategoryId = Schema.String.check(Schema.isUUID()).pipe(Schema.brand("CategoryId"));
export const CounterpartyId = Schema.String.check(Schema.isUUID()).pipe(
  Schema.brand("CounterpartyId"),
);
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
export const RoleSource = Schema.Literals(["user", "rule", "bank", "counterparty", "link"]);
export type RoleSource = typeof RoleSource.Type;
export const CategorySource = Schema.Literals(["user", "rule", "counterparty", "bank"]);
export type CategorySource = typeof CategorySource.Type;
export const CounterpartySource = Schema.Literals(["user", "alias"]);
export const CounterpartyKind = Schema.Literals([
  "business",
  "person",
  "ownAccount",
  "institution",
]);
export type CounterpartyKind = typeof CounterpartyKind.Type;
export const CounterpartyRole = Schema.Literals([
  "purchase",
  "income",
  "transfer",
  "refund",
  "reimbursement",
]);
export const CategoryTree = Schema.Literals(["spending", "income"]);
export type CategoryTree = typeof CategoryTree.Type;
// A category with everything below it, or `uncategorised` for money whose role takes a
// category that it does not have yet.
export const CategoryChoice = Schema.Union([CategoryId, Schema.Literal("uncategorised")]);
export type CategoryChoice = typeof CategoryChoice.Type;
export const InterpretationFilter = Schema.Struct({
  role: Schema.optionalKey(FinancialRole),
  categoryId: Schema.optionalKey(CategoryChoice),
  counterpartyId: Schema.optionalKey(CounterpartyId),
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
  // The reference reduced to the words that say what a payment was for, so "Rent Aug"
  // and "rent 2026" share the key "rent".
  referenceKey: Schema.NullOr(Schema.String),
  foreign: Schema.NullOr(Schema.Struct({ currency: Schema.String, amount: Schema.String })),
});
export type Descriptor = typeof Descriptor.Type;

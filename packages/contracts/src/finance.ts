import { Schema } from "effect";

export const AccountId = Schema.String.check(Schema.isUUID()).pipe(Schema.brand("AccountId"));
export const ImportId = Schema.String.check(Schema.isUUID()).pipe(Schema.brand("ImportId"));
export const SourceFileId = Schema.String.check(Schema.isUUID()).pipe(Schema.brand("SourceFileId"));
export const PostingId = Schema.String.check(Schema.isUUID()).pipe(Schema.brand("PostingId"));
export const ObservationId = Schema.String.check(Schema.isUUID()).pipe(
  Schema.brand("ObservationId"),
);
export const ReviewItemId = Schema.String.check(Schema.isUUID()).pipe(Schema.brand("ReviewItemId"));
export const CommandId = Schema.String.check(Schema.isUUID()).pipe(Schema.brand("CommandId"));
export const AccountKind = Schema.Literals(["deposit", "card", "loan"]);
export const Currency = Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/));
export const Version = Schema.Int.check(Schema.isGreaterThan(0));
export const Account = Schema.Struct({
  id: AccountId,
  kind: AccountKind,
  label: Schema.String,
  currency: Currency,
  bankId: Schema.NullOr(Schema.String),
  accountNumber: Schema.NullOr(Schema.String),
  version: Version,
});
export type Account = typeof Account.Type;

export class FinanceError extends Schema.TaggedError<FinanceError>()("FinanceError", {
  kind: Schema.Literals(["invalid", "notFound", "stale", "conflict", "needsReview", "unavailable"]),
  message: Schema.String,
}) {}

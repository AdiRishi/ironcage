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
export const MinorUnits = Schema.BigIntFromString;
export const Money = Schema.Struct({ currency: Currency, minor: MinorUnits });
export type Money = typeof Money.Type;

export const CalendarDate = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/),
  Schema.makeFilter((value) => {
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(5, 7));
    const day = Number(value.slice(8, 10));
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    const maximum = days[month - 1];
    return (
      (year >= 1 && maximum !== undefined && day >= 1 && day <= maximum) || "Invalid calendar date"
    );
  }),
).pipe(Schema.brand("CalendarDate"));
export type CalendarDate = typeof CalendarDate.Type;

export class FinanceError extends Schema.TaggedError<FinanceError>()("FinanceError", {
  kind: Schema.Literals(["invalid", "notFound", "stale", "conflict", "needsReview", "unavailable"]),
  message: Schema.String,
}) {}

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
export const YearMonth = Schema.String.check(
  Schema.isPattern(/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/),
).pipe(Schema.brand("YearMonth"));
export type YearMonth = typeof YearMonth.Type;

export class FinanceError extends Schema.TaggedError<FinanceError>()("FinanceError", {
  kind: Schema.Literals(["invalid", "notFound", "stale", "conflict", "needsReview", "unavailable"]),
  message: Schema.String,
}) {}

export const Instant = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3,6}Z$/),
);
export type Instant = typeof Instant.Type;

export const RecordCursor = Schema.Struct({
  createdAt: Instant,
  id: Schema.String.check(Schema.isUUID()),
});
export const MatchMethod = Schema.Literals([
  "sameRow",
  "bankId",
  "group",
  "corroborated",
  "new",
  "user",
]);
export type MatchMethod = typeof MatchMethod.Type;

// A bank whose files and descriptors Ironcage reads. Each registry keyed by it must
// cover every institution: descriptor profiles, file parsers, and display names.
export const Institution = Schema.Literals(["commbank"]);
export type Institution = typeof Institution.Type;
export const institutionNames = { commbank: "CommBank" } satisfies Record<Institution, string>;

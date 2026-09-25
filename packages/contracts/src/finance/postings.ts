import { Schema, Struct } from "effect";

import {
  CountedScope,
  DateBasis,
  PartSign,
  Period,
  PeriodSelection,
  ScopeCrumb,
} from "./analysis.ts";
import { Candidate, Locator } from "./imports.ts";
import {
  CategoryId,
  CounterpartyId,
  EventId,
  FinancialRole,
  InterpretationFilter,
} from "./interpretation.ts";
import {
  AccountId,
  CalendarDate,
  Currency,
  ImportId,
  Instant,
  MatchMethod,
  Money,
  ObservationId,
  PostingId,
  SourceFileId,
  Version,
} from "./values.ts";

export const Posting = Schema.Struct({
  id: PostingId,
  accountId: AccountId,
  accountLabel: Schema.String,
  postedOn: CalendarDate,
  valueOn: Schema.NullOr(CalendarDate),
  amount: Money,
  description: Schema.String,
  originalMoney: Schema.NullOr(Money),
});
export type Posting = typeof Posting.Type;
export const PostingFilter = Schema.Struct({
  ...InterpretationFilter.fields,
  accountId: Schema.optionalKey(AccountId),
  currency: Schema.optionalKey(Currency),
  from: Schema.optionalKey(CalendarDate),
  to: Schema.optionalKey(CalendarDate),
  minimum: Schema.optionalKey(Schema.String.check(Schema.isPattern(/^-?\d+$/))),
  maximum: Schema.optionalKey(Schema.String.check(Schema.isPattern(/^-?\d+$/))),
  description: Schema.optionalKey(Schema.String),
  needsReview: Schema.optionalKey(Schema.Boolean),
  importId: Schema.optionalKey(ImportId),
});
export const PostingCursor = Schema.Struct({ postedOn: CalendarDate, id: PostingId });
export const ListPostings = Schema.Struct({
  filter: PostingFilter,
  cursor: Schema.optionalKey(PostingCursor),
});
export const PostingPage = Schema.Struct({
  rows: Schema.Array(Posting),
  nextCursor: Schema.NullOr(PostingCursor),
});
export const PostingInput = Schema.Struct({ postingId: PostingId });
export const SourceReference = Schema.Struct({
  sourceFileId: SourceFileId,
  fileName: Schema.String,
  bytesAvailable: Schema.Boolean,
  locator: Locator,
});
export const Evidence = Schema.Struct({
  id: ObservationId,
  ...SourceReference.fields,
  raw: Schema.Record(Schema.String, Schema.String),
  candidate: Schema.NullOr(Candidate),
  matchMethod: Schema.NullOr(MatchMethod),
});
// `descriptor` is the alias key that names the transaction's counterparty: the one its
// primary posting's text reduces to, null when that text names no counterparty.
// `eventCount` counts the transactions that move with the descriptor: those written with
// that key whose counterparty you did not set by hand, and this one. `aliasVersion` is
// null while no counterparty holds the key.
export const PostingDetail = Schema.Struct({
  posting: Posting,
  evidence: Schema.Array(Evidence),
  descriptor: Schema.NullOr(
    Schema.Struct({
      aliasKey: Schema.String,
      counterpartyText: Schema.NullOr(Schema.String),
      eventCount: Schema.Int,
      aliasVersion: Schema.NullOr(Version),
    }),
  ),
});

// A posting with what it means, for the ledger list.
export const LedgerRow = Schema.Struct({
  ...Posting.fields,
  eventId: Schema.NullOr(EventId),
  role: Schema.NullOr(FinancialRole),
  counterpartyId: Schema.NullOr(CounterpartyId),
  counterpartyName: Schema.NullOr(Schema.String),
  categoryId: Schema.NullOr(CategoryId),
  categoryName: Schema.NullOr(Schema.String),
  categorySlug: Schema.NullOr(Schema.String),
  split: Schema.Boolean,
  assignedBy: Schema.Literals(["you", "rule", "model", "bank", "none"]),
  question: Schema.Boolean,
});
export type LedgerRow = typeof LedgerRow.Type;
export const LedgerPage = Schema.Struct({
  rows: Schema.Array(LedgerRow),
  nextCursor: Schema.NullOr(PostingCursor),
});

// The records behind one number: every posting whose ledger facts count toward a scope
// in a period. The scope replaces the category and counterparty filters, and the period
// replaces the dates.
export const CountedFilter = Schema.Struct(
  Struct.omit(PostingFilter.fields, ["categoryId", "counterpartyId", "currency", "from", "to"]),
);
// The position of a part in its measure's definition.
const PartIndex = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
export const CountedCursor = Schema.Struct({ part: PartIndex, on: CalendarDate, id: PostingId });
export const ListCountedLedger = Schema.Struct({
  scope: CountedScope,
  period: PeriodSelection,
  basis: DateBasis,
  currency: Currency,
  filter: CountedFilter,
  cursor: Schema.optionalKey(CountedCursor),
});
// `counted` is what the posting's facts add to the part, signed the way the bank booked
// the money, and `on` is the date the basis places them on.
export const CountedLedgerRow = Schema.Struct({
  ...LedgerRow.fields,
  part: PartIndex,
  on: CalendarDate,
  counted: Money,
});
// `amount` is the part as its measure counts it, which `sign` adds to the total or takes
// off it.
export const CountedPart = Schema.Struct({
  label: Schema.String,
  sign: PartSign,
  amount: Money,
  postings: Schema.Int,
});
// `total` equals the number the scope was opened from. `path` holds the crumbs that
// narrow the measure to the scope, and `label` names the last of them, or the measure.
export const CountedLedgerPage = Schema.Struct({
  scope: CountedScope,
  label: Schema.String,
  path: Schema.Array(ScopeCrumb),
  period: Period,
  basis: DateBasis,
  currency: Currency,
  calculatedAt: Instant,
  total: Money,
  parts: Schema.Array(CountedPart),
  rows: Schema.Array(CountedLedgerRow),
  nextCursor: Schema.NullOr(CountedCursor),
});

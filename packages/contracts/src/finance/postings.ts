import { Schema } from "effect";

import { Candidate, Locator } from "./imports.ts";
import {
  AccountId,
  CalendarDate,
  Currency,
  ImportId,
  Money,
  ObservationId,
  PostingId,
  SourceFileId,
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
  accountId: Schema.optional(AccountId),
  currency: Schema.optional(Currency),
  from: Schema.optional(CalendarDate),
  to: Schema.optional(CalendarDate),
  minimum: Schema.optional(Schema.String.check(Schema.isPattern(/^-?\d+$/))),
  maximum: Schema.optional(Schema.String.check(Schema.isPattern(/^-?\d+$/))),
  description: Schema.optional(Schema.String),
  needsReview: Schema.optional(Schema.Boolean),
  importId: Schema.optional(ImportId),
});
export const PostingCursor = Schema.Struct({ postedOn: CalendarDate, id: PostingId });
export const ListPostings = Schema.Struct({
  filter: PostingFilter,
  cursor: Schema.optional(PostingCursor),
});
export const PostingPage = Schema.Struct({
  rows: Schema.Array(Posting),
  nextCursor: Schema.NullOr(PostingCursor),
});
export const PostingInput = Schema.Struct({ postingId: PostingId });
export const Evidence = Schema.Struct({
  id: ObservationId,
  sourceFileId: SourceFileId,
  fileName: Schema.String,
  bytesAvailable: Schema.Boolean,
  locator: Locator,
  raw: Schema.Record(Schema.String, Schema.String),
  candidate: Schema.NullOr(Candidate),
  matchMethod: Schema.NullOr(Schema.String),
});
export const PostingDetail = Schema.Struct({ posting: Posting, evidence: Schema.Array(Evidence) });

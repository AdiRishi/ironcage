import { Schema } from "effect";

import { Candidate, Locator } from "./imports.ts";
import { InterpretationFilter } from "./interpretation.ts";
import {
  AccountId,
  CalendarDate,
  Currency,
  ImportId,
  MatchMethod,
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
export const PostingDetail = Schema.Struct({ posting: Posting, evidence: Schema.Array(Evidence) });

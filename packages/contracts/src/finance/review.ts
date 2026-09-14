import { Schema } from "effect";

import { Candidate, Locator } from "./imports.ts";
import { Posting, SourceReference } from "./postings.ts";
import {
  AccountId,
  CommandId,
  ImportId,
  ObservationId,
  PostingId,
  ReviewItemId,
  RecordCursor,
  SourceFileId,
  Version,
} from "./values.ts";

export const ObservationDecision = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("match"), postingId: PostingId }),
  Schema.Struct({ kind: Schema.Literal("distinct") }),
  Schema.Struct({ kind: Schema.Literal("omit"), reason: Schema.Trim.check(Schema.isMinLength(1)) }),
  Schema.Struct({
    kind: Schema.Literal("correct"),
    candidate: Candidate,
    postingId: Schema.NullOr(PostingId),
  }),
  Schema.Struct({ kind: Schema.Literal("keep"), candidate: Candidate, postingId: PostingId }),
]);
export type ObservationDecision = typeof ObservationDecision.Type;
export const ReviewQuestion = Schema.Struct({
  reason: Schema.Literals([
    "changedSource",
    "changedBankId",
    "ambiguousGroup",
    "conflictingBalances",
    "accountMissing",
    "accountConflict",
    "unreadableValue",
    "unreconciled",
  ]),
  message: Schema.String,
});
export const ReviewKind = Schema.Literals(["account", "value", "duplicate", "source_conflict"]);
export const ReviewObservation = Schema.Struct({
  id: ObservationId,
  locator: Locator,
  raw: Schema.Record(Schema.String, Schema.String),
  candidate: Schema.NullOr(Candidate),
  acceptedCandidate: Schema.NullOr(Candidate),
  postingId: Schema.NullOr(PostingId),
});
export const ReviewResolution = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("account"), accountId: AccountId }),
  Schema.Struct({
    kind: Schema.Literal("observations"),
    decisions: Schema.NonEmptyArray(
      Schema.Struct({ observationId: ObservationId, decision: ObservationDecision }),
    ),
  }),
]);
export const ReviewCandidate = Schema.Struct({
  ...Posting.fields,
  sources: Schema.Array(SourceReference),
});
export const ReviewItem = Schema.Struct({
  id: ReviewItemId,
  importId: ImportId,
  fileName: Schema.String,
  sourceFileId: SourceFileId,
  bytesAvailable: Schema.Boolean,
  kind: ReviewKind,
  question: ReviewQuestion,
  observations: Schema.Array(ReviewObservation),
  candidates: Schema.Array(ReviewCandidate),
  version: Version,
  createdAt: Schema.String,
  resolvedAt: Schema.NullOr(Schema.String),
  resolution: Schema.NullOr(ReviewResolution),
});
export type ReviewItem = typeof ReviewItem.Type;
export const ResolveReview = Schema.Struct({
  commandId: CommandId,
  reviewItemId: ReviewItemId,
  expectedVersion: Version,
  resolution: ReviewResolution,
});
export const ListReviewItems = Schema.Struct({
  open: Schema.optionalKey(Schema.Boolean),
  importId: Schema.optionalKey(ImportId),
  cursor: Schema.optionalKey(RecordCursor),
});

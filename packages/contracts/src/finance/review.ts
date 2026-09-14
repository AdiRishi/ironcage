import { Schema } from "effect";

import { Candidate, Locator } from "./imports.ts";
import { Posting } from "./postings.ts";
import {
  AccountId,
  CommandId,
  ImportId,
  ObservationId,
  PostingId,
  ReviewItemId,
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
export const ReviewItem = Schema.Struct({
  id: ReviewItemId,
  importId: ImportId,
  fileName: Schema.String,
  kind: ReviewKind,
  question: ReviewQuestion,
  observations: Schema.Array(ReviewObservation),
  candidates: Schema.Array(Posting),
  version: Version,
  createdAt: Schema.String,
});
export type ReviewItem = typeof ReviewItem.Type;
export const ResolveReview = Schema.Struct({
  commandId: CommandId,
  reviewItemId: ReviewItemId,
  expectedVersion: Version,
  resolution: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("account"), accountId: AccountId }),
    Schema.Struct({
      kind: Schema.Literal("observations"),
      decisions: Schema.NonEmptyArray(
        Schema.Struct({ observationId: ObservationId, decision: ObservationDecision }),
      ),
    }),
  ]),
});

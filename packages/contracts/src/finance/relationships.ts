import { Schema } from "effect";

import { ExpectedEventVersion, MeasureImpact } from "./corrections.ts";
import { FinancialEvent } from "./events.ts";
import { AllocationId, EventId, FinancialRole } from "./interpretation.ts";
import { Posting, PostingCursor } from "./postings.ts";
import {
  AccountId,
  CommandId,
  Money,
  ObservationId,
  Version,
  ReviewItemId,
  CalendarDate,
} from "./values.ts";

export const CreditLinkId = Schema.String.check(Schema.isUUID()).pipe(Schema.brand("CreditLinkId"));
export const MovementKind = Schema.Literals([
  "transfer",
  "cardSettlement",
  "loanPayment",
  "borrowing",
]);
export const Endpoint = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("account"), accountId: AccountId }),
  Schema.Struct({
    kind: Schema.Literal("external"),
    label: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  }),
]);
export const MovementLink = Schema.Struct({
  eventId: EventId,
  from: Endpoint,
  to: Endpoint,
  evidence: Schema.Array(ObservationId),
  absorbedEventId: Schema.NullOr(EventId),
});
export const CreditLink = Schema.Struct({
  id: CreditLinkId,
  creditAllocationId: AllocationId,
  costAllocationId: AllocationId,
  amount: Money,
  creditEventId: EventId,
  costEventId: EventId,
});
export const FeeAssociation = Schema.Struct({
  feeEventId: EventId,
  purchaseEventId: EventId,
  status: Schema.Literals(["proposed", "confirmed"]),
});
export const RelationshipChange = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("linkMovement"),
    eventId: EventId,
    movementKind: MovementKind,
    counterpart: Schema.Union([
      Schema.Struct({ kind: Schema.Literal("event"), eventId: EventId }),
      Endpoint,
    ]),
  }),
  Schema.Struct({ kind: Schema.Literal("unlinkMovement"), eventId: EventId }),
  Schema.Struct({
    kind: Schema.Literal("linkCredit"),
    creditAllocationId: AllocationId,
    costAllocationId: AllocationId,
    amount: Money,
  }),
  Schema.Struct({ kind: Schema.Literal("unlinkCredit"), creditLinkId: CreditLinkId }),
  Schema.Struct({
    kind: Schema.Literal("associateFee"),
    feeEventId: EventId,
    purchaseEventId: EventId,
    status: FeeAssociation.fields.status,
  }),
  Schema.Struct({ kind: Schema.Literal("removeFee"), feeEventId: EventId }),
]);
export type RelationshipChange = typeof RelationshipChange.Type;
export const PreviewRelationship = Schema.Struct({ change: RelationshipChange });
export const ApplyRelationship = Schema.Struct({
  commandId: CommandId,
  change: RelationshipChange,
  expectedVersions: Schema.NonEmptyArray(ExpectedEventVersion),
});
export const RelationshipPreview = Schema.Struct({
  change: RelationshipChange,
  expectedVersions: Schema.NonEmptyArray(ExpectedEventVersion),
  events: Schema.Array(FinancialEvent),
  impacts: Schema.Array(MeasureImpact),
});
export const EventRelationships = Schema.Struct({
  movement: Schema.NullOr(MovementLink),
  credits: Schema.Array(CreditLink),
  fees: Schema.Array(FeeAssociation),
  remaining: Schema.Array(Schema.Struct({ allocationId: AllocationId, amount: Money })),
});
export const RelationshipCandidate = Schema.Struct({
  eventId: EventId,
  allocationId: AllocationId,
  kind: FinancialRole,
  version: Version,
  posting: Posting,
  remaining: Money,
});
export const ListRelationshipCandidates = Schema.Struct({
  eventId: EventId,
  kind: Schema.Literals(["movement", "cost", "purchase"]),
  search: Schema.String,
  cursor: Schema.optionalKey(PostingCursor),
});
export const RelationshipCandidatePage = Schema.Struct({
  rows: Schema.Array(RelationshipCandidate),
  nextCursor: Schema.NullOr(PostingCursor),
});
export const ProposeRelationships = Schema.Struct({ commandId: CommandId });
export const InterpretationReview = Schema.Struct({
  id: ReviewItemId,
  eventIds: Schema.Array(EventId),
  postingId: Posting.fields.id,
  description: Schema.String,
  postedOn: CalendarDate,
  version: Version,
});
export const InterpretationReviewCursor = Schema.Struct({
  postedOn: CalendarDate,
  id: ReviewItemId,
});
export const InterpretationReviewPage = Schema.Struct({
  rows: Schema.Array(InterpretationReview),
  nextCursor: Schema.NullOr(InterpretationReviewCursor),
});
export const ListInterpretationReviews = Schema.Struct({
  cursor: Schema.optionalKey(InterpretationReviewCursor),
});
export const DismissInterpretationReview = Schema.Struct({
  commandId: CommandId,
  reviewId: ReviewItemId,
  expectedVersion: Version,
});

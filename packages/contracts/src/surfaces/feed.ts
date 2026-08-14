import { FeedEventId, Instant, RequestId } from "@ironcage/domain";
import { Schema } from "effect";
import { Rpc as RpcModule } from "effect/unstable/rpc";

import { Conflict, Internal, NotFound } from "./errors";

export const FeedSeverity = Schema.Literals(["info", "notice", "warning", "critical"]);
export type FeedSeverity = typeof FeedSeverity.Type;

export const FeedEventView = Schema.Struct({
  id: FeedEventId,
  occurredAt: Instant,
  origin: Schema.String,
  category: Schema.String,
  eventType: Schema.String,
  severity: FeedSeverity,
  summary: Schema.String,
  payload: Schema.Unknown,
  links: Schema.NullOr(Schema.Unknown),
  acknowledgedAt: Schema.NullOr(Instant),
});
export type FeedEventView = typeof FeedEventView.Type;

/**
 * Feed cursors are event IDs: UUIDv7 is time-ordered, so paging newest-first
 * means everything strictly older than the cursor.
 */
export const getFeedRpc = RpcModule.make("getFeed", {
  payload: {
    cursor: Schema.NullOr(FeedEventId),
    categories: Schema.Array(Schema.String),
    severities: Schema.Array(FeedSeverity),
    limit: Schema.Int,
  },
  success: Schema.Struct({
    events: Schema.Array(FeedEventView),
    nextCursor: Schema.NullOr(FeedEventId),
  }),
  error: Schema.Union([NotFound, Internal]),
});

export const acknowledgeRpc = RpcModule.make("acknowledge", {
  payload: { requestId: RequestId, eventId: FeedEventId },
  success: FeedEventView,
  error: Schema.Union([NotFound, Conflict, Internal]),
});

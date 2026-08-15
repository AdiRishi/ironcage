import { FeedCursor, FeedEventId, Instant, RequestId } from "@ironcage/domain";
import { Schema } from "effect";
import { Rpc as RpcModule } from "effect/unstable/rpc";

import { Conflict, Internal, NotFound } from "./errors";

export const FeedSeverity = Schema.Literals(["info", "notice", "warning", "critical"]);
export type FeedSeverity = typeof FeedSeverity.Type;

export const FeedEventView = Schema.Struct({
  id: FeedEventId,
  cursor: FeedCursor,
  occurredAt: Instant,
  origin: Schema.String,
  category: Schema.String,
  eventType: Schema.String,
  severity: FeedSeverity,
  summary: Schema.String,
  payload: Schema.Json,
  links: Schema.NullOr(Schema.Json),
  acknowledgedAt: Schema.NullOr(Instant),
});
export type FeedEventView = typeof FeedEventView.Type;

export const GetFeedInput = Schema.Struct({
  cursor: Schema.NullOr(FeedCursor),
  categories: Schema.Array(Schema.String),
  severities: Schema.Array(FeedSeverity),
  limit: Schema.Int,
});

export const FeedPage = Schema.Struct({
  events: Schema.Array(FeedEventView),
  nextCursor: Schema.NullOr(FeedCursor),
});
export type FeedPage = typeof FeedPage.Type;

export const getFeedRpc = RpcModule.make("getFeed", {
  payload: GetFeedInput.fields,
  success: FeedPage,
  error: Schema.Union([NotFound, Internal]),
});

export const AcknowledgeInput = Schema.Struct({ requestId: RequestId, eventId: FeedEventId });

export const acknowledgeRpc = RpcModule.make("acknowledge", {
  payload: AcknowledgeInput.fields,
  success: FeedEventView,
  error: Schema.Union([NotFound, Conflict, Internal]),
});

export const FeedFilter = Schema.Struct({
  categories: Schema.Array(Schema.String),
  severities: Schema.Array(FeedSeverity),
});
export type FeedFilter = typeof FeedFilter.Type;

export const FeedClientFrame = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("Subscribe"),
    since: Schema.NullOr(FeedCursor),
    filter: FeedFilter,
  }),
  Schema.Struct({ _tag: Schema.Literal("Ack"), through: FeedCursor }),
  Schema.Struct({ _tag: Schema.Literal("Heartbeat") }),
]);
export type FeedClientFrame = typeof FeedClientFrame.Type;

export const FeedServerFrame = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("Ready"),
    cursor: Schema.NullOr(FeedCursor),
    replayed: Schema.Int,
    serverTime: Instant,
  }),
  Schema.Struct({ _tag: Schema.Literal("Event"), event: FeedEventView }),
  Schema.Struct({ _tag: Schema.Literal("HeartbeatAck") }),
  Schema.Struct({
    _tag: Schema.Literal("Lagged"),
    from: Schema.NullOr(FeedCursor),
    through: Schema.NullOr(FeedCursor),
  }),
  Schema.Struct({
    _tag: Schema.Literal("Closing"),
    reason: Schema.Literals(["token-expired", "lease-expired", "shutdown"]),
    at: Instant,
  }),
]);
export type FeedServerFrame = typeof FeedServerFrame.Type;

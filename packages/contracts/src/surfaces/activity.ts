import { FeedEvent, FeedEventId, FeedSeverity, RequestId } from "@ironcage/domain";
import { Schema } from "effect";
import { Rpc as RpcModule } from "effect/unstable/rpc";

import { BoundaryError } from "./errors";

const FeedQuery = {
  cursor: Schema.NullOr(FeedEventId),
  limit: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(100)),
  origins: Schema.Array(Schema.String),
  categories: Schema.Array(Schema.String),
  severities: Schema.Array(FeedSeverity),
  occurredFrom: Schema.NullOr(Schema.DateTimeUtcFromString),
  occurredThrough: Schema.NullOr(Schema.DateTimeUtcFromString),
  search: Schema.NullOr(Schema.String),
};

export const getFeedRpc = RpcModule.make("getFeed", {
  payload: FeedQuery,
  success: Schema.Struct({
    events: Schema.Array(FeedEvent),
    nextCursor: Schema.NullOr(FeedEventId),
  }),
  error: BoundaryError,
});

export const getAttentionItemsRpc = RpcModule.make("getAttentionItems", {
  success: Schema.Array(FeedEvent),
  error: BoundaryError,
});

export const acknowledgeFeedEventRpc = RpcModule.make("acknowledgeFeedEvent", {
  payload: { eventId: FeedEventId, requestId: RequestId },
  success: FeedEvent,
  error: BoundaryError,
});

import type { FeedEvent, FeedEventId, FeedSeverity, RequestId, Sha256 } from "@ironcage/domain";
import { Context, Effect, type DateTime } from "effect";

import type { PersistenceError, StoredRequest } from "../persistence";

export interface FeedQuery {
  readonly cursor: FeedEventId | null;
  readonly limit: number;
  readonly origins: readonly string[];
  readonly categories: readonly string[];
  readonly severities: readonly FeedSeverity[];
  readonly occurredFrom: DateTime.Utc | null;
  readonly occurredThrough: DateTime.Utc | null;
  readonly search: string | null;
}

export interface FeedPage {
  readonly events: readonly FeedEvent[];
  readonly nextCursor: FeedEventId | null;
}

export interface AcknowledgeEventPlan {
  readonly event: FeedEvent;
  readonly acknowledgedAt: DateTime.Utc;
  readonly requestId: RequestId;
  readonly payloadHash: Sha256;
}

export interface ActivityTransaction {
  readonly request: (requestId: RequestId) => Effect.Effect<StoredRequest | null, PersistenceError>;
  readonly event: (eventId: FeedEventId) => Effect.Effect<FeedEvent | null, PersistenceError>;
  readonly acknowledge: (plan: AcknowledgeEventPlan) => Effect.Effect<FeedEvent, PersistenceError>;
}

export class ActivityRepository extends Context.Service<
  ActivityRepository,
  {
    readonly list: (query: FeedQuery) => Effect.Effect<FeedPage, PersistenceError>;
    readonly attention: Effect.Effect<readonly FeedEvent[], PersistenceError>;
    readonly withTransaction: <A, E, R>(
      use: (transaction: ActivityTransaction) => Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E | PersistenceError, R>;
  }
>()("ironcage/core/activity/ActivityRepository") {}

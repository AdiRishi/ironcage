import type { FeedEventId } from "@ironcage/domain";
import { Effect } from "effect";

import type { PersistenceError, SqlExecutor } from "../../persistence";

export interface FeedEventInsert {
  readonly id: FeedEventId;
  readonly origin: string;
  readonly category: string;
  readonly eventType: string;
  readonly severity: "info" | "notice" | "warning" | "critical";
  readonly summary: string;
  readonly payload: unknown;
  readonly links: unknown;
}

export const insertFeedEvent = (
  sql: SqlExecutor,
  event: FeedEventInsert,
): Effect.Effect<void, PersistenceError> =>
  sql
    .query(
      "insert feed event",
      `INSERT INTO feed_events (id, occurred_at, origin, category, event_type, severity, summary, payload, links)
       VALUES ($1, now(), $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)`,
      [
        event.id,
        event.origin,
        event.category,
        event.eventType,
        event.severity,
        event.summary,
        JSON.stringify(event.payload),
        event.links === null ? null : JSON.stringify(event.links),
      ],
    )
    .pipe(Effect.asVoid);

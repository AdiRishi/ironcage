import type { FeedEventId } from "@ironcage/domain";
import { Effect, Schema } from "effect";

import type { SqlExecutor } from "../../persistence";

export interface FeedEventInsert<Payload, Links> {
  readonly id: FeedEventId;
  readonly origin: string;
  readonly category: string;
  readonly eventType: string;
  readonly severity: "info" | "notice" | "warning" | "critical";
  readonly summary: string;
  readonly payload: Payload;
  readonly links: Links | null;
}

const decodeJson = Schema.decodeUnknownSync(Schema.Json);

export const insertFeedEvent = Effect.fn("insertFeedEvent")(function* <Payload, Links>(
  sql: SqlExecutor,
  event: FeedEventInsert<Payload, Links>,
) {
  const payload = decodeJson(event.payload);
  const links = event.links === null ? null : decodeJson(event.links);
  yield* sql.execute(
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
      JSON.stringify(payload),
      links === null ? null : JSON.stringify(links),
    ],
  );
  yield* sql.execute(
    "enqueue feed event",
    `INSERT INTO feed_dispatches (event_id, status, created_at)
       VALUES ($1, 'pending', now())`,
    [event.id],
  );
});

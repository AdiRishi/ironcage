import { FeedEventView } from "@ironcage/contracts/schema";
import { FeedEventId } from "@ironcage/domain";
import { Effect, Schema } from "effect";

import type { SqlExecutor } from "../../persistence/postgres";
import { feedColumns } from "./events";

const PendingFeedDispatch = Schema.Struct({
  eventId: FeedEventId,
  event: FeedEventView,
});

export const listPendingFeedDispatches = (sql: SqlExecutor, limit: number) =>
  Effect.gen(function* () {
    return yield* sql.rows(
      "list pending feed dispatches",
      PendingFeedDispatch,
      `SELECT d.event_id AS "eventId", to_jsonb(event_row) AS event
         FROM feed_dispatches d
         JOIN LATERAL (
           SELECT ${feedColumns}
             FROM feed_events e
             LEFT JOIN acknowledgments a ON a.event_id = e.id
            WHERE e.id = d.event_id
         ) event_row ON true
        WHERE d.status = 'pending'
        ORDER BY event_row.cursor::bigint
        LIMIT ${Math.min(Math.max(limit, 1), 500)}`,
    );
  });

export const encodeFeedEvent = Schema.encodeSync(FeedEventView);

export const markFeedDispatched = (sql: SqlExecutor, eventId: FeedEventId) =>
  sql.execute(
    "mark feed dispatched",
    `UPDATE feed_dispatches
          SET status = 'dispatched', dispatched_at = now(), attempts = attempts + 1,
              last_error = NULL
        WHERE event_id = $1`,
    [eventId],
  );

export const recordFeedDispatchFailure = (sql: SqlExecutor, eventId: FeedEventId, error: string) =>
  sql.execute(
    "record feed dispatch failure",
    `UPDATE feed_dispatches
          SET attempts = attempts + 1, last_error = left($2, 4000)
        WHERE event_id = $1`,
    [eventId, error],
  );

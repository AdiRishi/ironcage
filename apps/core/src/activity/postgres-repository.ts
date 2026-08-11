import { FeedEvent, FeedEventId, RequestId, Sha256 } from "@ironcage/domain";
import { DateTime, Effect, Layer, Schema } from "effect";

import {
  decodeRows,
  inTransaction,
  moneyRecordLock,
  type SqlExecutor,
  withClient,
} from "../money/postgres";
import {
  type AcknowledgeEventPlan,
  ActivityRepository,
  type ActivityTransaction,
  type FeedQuery,
} from "./repository";

const eventColumns = `
  e.id,
  to_char(e.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "occurredAt",
  e.origin,
  e.category,
  e.event_type AS "eventType",
  e.severity,
  e.summary,
  e.payload,
  e.links,
  CASE WHEN a.acknowledged_at IS NULL THEN NULL
       ELSE to_char(a.acknowledged_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
   END AS "acknowledgedAt"`;

const decodeEvents = (operation: string, rows: readonly Readonly<Record<string, unknown>>[]) =>
  decodeRows(operation, FeedEvent, rows);

const listWith = Effect.fn("ActivityPostgresRepository.listWith")(function* (
  sql: SqlExecutor,
  query: FeedQuery,
) {
  const rows = yield* sql.query(
    "read activity feed",
    `SELECT ${eventColumns}
       FROM feed_events e
       LEFT JOIN acknowledgments a ON a.event_id = e.id
      WHERE ($1::uuid IS NULL OR e.id < $1)
        AND (cardinality($2::text[]) = 0 OR e.origin = ANY($2))
        AND (cardinality($3::text[]) = 0 OR e.category = ANY($3))
        AND (cardinality($4::text[]) = 0 OR e.severity = ANY($4))
        AND ($5::timestamptz IS NULL OR e.occurred_at >= $5)
        AND ($6::timestamptz IS NULL OR e.occurred_at <= $6)
        AND ($7::text IS NULL OR e.summary ILIKE '%' || $7 || '%')
      ORDER BY e.id DESC
      LIMIT $8`,
    [
      query.cursor,
      query.origins,
      query.categories,
      query.severities,
      query.occurredFrom === null ? null : DateTime.toDateUtc(query.occurredFrom),
      query.occurredThrough === null ? null : DateTime.toDateUtc(query.occurredThrough),
      query.search,
      query.limit + 1,
    ],
  );
  const decoded = yield* decodeEvents("decode activity feed", rows);
  const events = decoded.slice(0, query.limit);

  return {
    events,
    nextCursor: decoded.length > query.limit ? (events.at(-1)?.id ?? null) : null,
  };
});

const attentionWith = Effect.fn("ActivityPostgresRepository.attentionWith")(function* (
  sql: SqlExecutor,
) {
  const rows = yield* sql.query(
    "read attention items",
    `SELECT ${eventColumns}
       FROM feed_events e
       LEFT JOIN acknowledgments a ON a.event_id = e.id
      WHERE e.severity = 'critical' AND a.event_id IS NULL
      ORDER BY e.id DESC`,
  );
  return yield* decodeEvents("decode attention items", rows);
});

const requestWith = Effect.fn("ActivityPostgresRepository.requestWith")(function* (
  sql: SqlExecutor,
  requestId: RequestId,
) {
  const rows = yield* sql.query(
    "read acknowledgment request",
    `SELECT request_id AS "requestId", operation, payload_hash AS "payloadHash", response
       FROM app_requests
      WHERE request_id = $1`,
    [requestId],
  );
  return (
    (yield* decodeRows(
      "decode acknowledgment request",
      Schema.Struct({
        requestId: RequestId,
        operation: Schema.String,
        payloadHash: Sha256,
        response: Schema.Unknown,
      }),
      rows,
    ))[0] ?? null
  );
});

const eventWith = Effect.fn("ActivityPostgresRepository.eventWith")(function* (
  sql: SqlExecutor,
  eventId: FeedEventId,
) {
  const rows = yield* sql.query(
    "read feed event",
    `SELECT ${eventColumns}
       FROM feed_events e
       LEFT JOIN acknowledgments a ON a.event_id = e.id
      WHERE e.id = $1`,
    [eventId],
  );
  return (yield* decodeEvents("decode feed event", rows))[0] ?? null;
});

const acknowledgeWith = Effect.fn("ActivityPostgresRepository.acknowledgeWith")(function* (
  sql: SqlExecutor,
  plan: AcknowledgeEventPlan,
) {
  yield* sql.query(
    "acknowledge critical feed event",
    `INSERT INTO acknowledgments (event_id, acknowledged_at)
     VALUES ($1,$2)
     ON CONFLICT (event_id) DO NOTHING`,
    [plan.event.id, DateTime.toDateUtc(plan.acknowledgedAt)],
  );
  yield* sql.query(
    "record acknowledgment request",
    `INSERT INTO app_requests (request_id, operation, payload_hash, response, completed_at)
     VALUES ($1,'activity.acknowledge',$2,$3::jsonb,$4)`,
    [
      plan.requestId,
      plan.payloadHash,
      JSON.stringify(Schema.encodeSync(FeedEvent)(plan.event)),
      DateTime.toDateUtc(plan.acknowledgedAt),
    ],
  );
  return plan.event;
});

export const postgresActivityRepositoryLayer = (connectionString: string) =>
  Layer.succeed(
    ActivityRepository,
    ActivityRepository.of({
      list: (query) => withClient(connectionString, (sql) => listWith(sql, query)),
      attention: withClient(connectionString, attentionWith),
      withTransaction: (use) =>
        inTransaction(connectionString, moneyRecordLock, (sql) => {
          const transaction: ActivityTransaction = {
            request: (requestId) => requestWith(sql, requestId),
            event: (eventId) => eventWith(sql, eventId),
            acknowledge: (plan) => acknowledgeWith(sql, plan),
          };
          return use(transaction);
        }),
    }),
  );

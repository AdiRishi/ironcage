import { FeedEventView, NotFound, type MoneyAnalysis } from "@ironcage/contracts/schema";
import { FeedCursor, FeedEventId, monthOf, type RequestId, type Sha256 } from "@ironcage/domain";
import { BigDecimal, Effect, Schema } from "effect";

import { mintId } from "../../ids";
import { runIdempotentMutation } from "../../persistence/app-requests";
import { persistenceToBoundary, type PersistenceError } from "../../persistence/error";
import { Postgres, type SqlExecutor } from "../../persistence/postgres";
import type { AccountRow } from "../accounts/repository";
import type { CoveredSpan } from "../import/coverage";
import { insertFeedEvent } from "./repository";

export const FeedEventRow = Schema.Struct({
  id: FeedEventId,
  cursor: FeedCursor,
  occurredAt: Schema.DateTimeUtcFromDate,
  origin: Schema.String,
  category: Schema.String,
  eventType: Schema.String,
  severity: Schema.Literals(["info", "notice", "warning", "critical"]),
  summary: Schema.String,
  payload: Schema.Json,
  links: Schema.NullOr(Schema.Json),
  acknowledgedAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
});

export const feedColumns = `e.id, e.sequence::text AS cursor, e.occurred_at AS "occurredAt", e.origin, e.category,
  e.event_type AS "eventType", e.severity, e.summary, e.payload, e.links,
  a.acknowledged_at AS "acknowledgedAt"`;

export const replayFeed = (
  sql: SqlExecutor,
  input: {
    readonly since: FeedCursor | null;
    readonly categories: readonly string[];
    readonly severities: readonly string[];
    readonly limit: number;
  },
) =>
  Effect.gen(function* () {
    const highWaterRows = yield* sql.rows(
      "read feed high water",
      Schema.Struct({ cursor: FeedCursor }),
      "SELECT sequence::text AS cursor FROM feed_events ORDER BY sequence DESC LIMIT 1",
    );
    const cursor = highWaterRows[0]?.cursor ?? null;
    if (input.since === null || cursor === null) return { cursor, events: [] };

    const events = yield* sql.rows(
      "replay feed",
      FeedEventRow,
      `SELECT ${feedColumns}
         FROM feed_events e
         LEFT JOIN acknowledgments a ON a.event_id = e.id
        WHERE e.sequence > $1::bigint AND e.sequence <= $2::bigint
          AND (cardinality($3::text[]) = 0 OR e.category = ANY($3))
          AND (cardinality($4::text[]) = 0 OR e.severity = ANY($4))
        ORDER BY e.sequence
        LIMIT ${input.limit}`,
      [input.since, cursor, [...input.categories], [...input.severities]],
    );
    return {
      cursor,
      events,
    };
  });

export const getFeed = (input: {
  readonly cursor: FeedCursor | null;
  readonly categories: readonly string[];
  readonly severities: readonly string[];
  readonly limit: number;
}) =>
  Effect.gen(function* () {
    const postgres = yield* Postgres;
    const limit = Math.min(Math.max(input.limit, 1), 200);

    const rows = yield* postgres.readTransaction((sql) =>
      sql.rows(
        "read feed",
        FeedEventRow,
        `SELECT ${feedColumns}
           FROM feed_events e
           LEFT JOIN acknowledgments a ON a.event_id = e.id
          WHERE ($1::bigint IS NULL OR e.sequence < $1)
            AND (cardinality($2::text[]) = 0 OR e.category = ANY($2))
            AND (cardinality($3::text[]) = 0 OR e.severity = ANY($3))
          ORDER BY e.sequence DESC
          LIMIT ${limit}`,
        [input.cursor, [...input.categories], [...input.severities]],
      ),
    );
    return {
      events: rows,
      nextCursor: rows.length === limit ? rows[rows.length - 1]!.cursor : null,
    };
  }).pipe(persistenceToBoundary);

export const acknowledge = (input: {
  readonly requestId: RequestId;
  readonly payloadHash: Sha256;
  readonly eventId: FeedEventId;
}) =>
  runIdempotentMutation(
    {
      requestId: input.requestId,
      operation: "acknowledge",
      payloadHash: input.payloadHash,
      response: FeedEventView,
    },
    (sql) =>
      Effect.gen(function* () {
        yield* sql.execute(
          "insert acknowledgment",
          `INSERT INTO acknowledgments (event_id, acknowledged_at)
           VALUES ($1, now()) ON CONFLICT (event_id) DO NOTHING`,
          [input.eventId],
        );
        const events = yield* sql.rows(
          "read acknowledged event",
          FeedEventRow,
          `SELECT ${feedColumns}
             FROM feed_events e LEFT JOIN acknowledgments a ON a.event_id = e.id
            WHERE e.id = $1`,
          [input.eventId],
        );
        const event = events[0];
        if (event === undefined) {
          return yield* Effect.fail(new NotFound({ entity: "feed event", id: input.eventId }));
        }
        return event;
      }),
  );

const spans = (list: readonly CoveredSpan[]) =>
  list.map((span) => `${span.start}..${span.end}`).join(", ");

const intersects = (a: CoveredSpan, b: CoveredSpan) => a.start <= b.end && b.start <= a.end;

/**
 * Coverage gap movements caused by one confirmed import: a gap that opened
 * (a disjoint window landed beyond existing coverage) warns; a gap the
 * import closed reports back.
 */
export const emitCoverageEvents = (
  sql: SqlExecutor,
  account: AccountRow,
  before: readonly CoveredSpan[],
  after: readonly CoveredSpan[],
): Effect.Effect<void, PersistenceError> =>
  Effect.gen(function* () {
    const closed = before.filter((gap) => !after.some((next) => intersects(gap, next)));
    const opened = after.filter((gap) => !before.some((previous) => intersects(gap, previous)));

    for (const gap of opened) {
      yield* insertFeedEvent(sql, {
        id: yield* mintId(FeedEventId),
        origin: "money",
        category: "money_tax",
        eventType: "bank_gap_detected",
        severity: "warning",
        summary: `${account.productLabel}: coverage gap ${spans([gap])}`,
        payload: { accountId: account.id, gap },
        links: null,
      });
    }
    for (const gap of closed) {
      yield* insertFeedEvent(sql, {
        id: yield* mintId(FeedEventId),
        origin: "money",
        category: "money_tax",
        eventType: "bank_gap_closed",
        severity: "info",
        summary: `${account.productLabel}: coverage gap ${spans([gap])} closed`,
        payload: { accountId: account.id, gap },
        links: null,
      });
    }
  }).pipe(Effect.asVoid);

const eventExists = (
  sql: SqlExecutor,
  eventType: string,
  subjectKey: string,
  subject: string,
  month: string,
) =>
  Effect.map(
    sql.rows(
      "check derived event dedupe",
      Schema.Struct({ exists: Schema.Int }),
      `SELECT 1 AS exists FROM feed_events
        WHERE event_type = $1 AND lower(payload->>'${subjectKey}') = lower($2) AND payload->>'month' = $3
        LIMIT 1`,
      [eventType, subject, month],
    ),
    (rows) => rows.length > 0,
  );

/**
 * Anomaly and price-change events for the months a confirmed import touched.
 * Identity is (rule, subject, calendar month), checked against the record, so
 * importing overlapping evidence does not emit an event again.
 */
export const emitDerivedEvents = (
  sql: SqlExecutor,
  touchedMonths: ReadonlySet<string>,
  analysis: MoneyAnalysis,
): Effect.Effect<void, PersistenceError> =>
  Effect.gen(function* () {
    if (touchedMonths.size === 0) return;

    const anomalies = analysis.anomalies.filter((anomaly) => touchedMonths.has(anomaly.month));
    for (const anomaly of anomalies) {
      if (yield* eventExists(sql, "spending_anomaly", "subject", anomaly.subject, anomaly.month)) {
        continue;
      }
      yield* insertFeedEvent(sql, {
        id: yield* mintId(FeedEventId),
        origin: "money",
        category: "money_tax",
        eventType: "spending_anomaly",
        severity: "notice",
        summary: `${anomaly.subject}: ${anomaly.detail}`,
        payload: {
          rule: anomaly.rule,
          subject: anomaly.subject,
          month: anomaly.month,
          amount: anomaly.amount === null ? null : BigDecimal.format(anomaly.amount),
        },
        links: null,
      });
    }

    for (const group of analysis.recurring) {
      if (group.priceChange === null) continue;
      const month = monthOf(group.priceChange.on);
      if (!touchedMonths.has(month)) continue;
      if (yield* eventExists(sql, "recurring_price_change", "payee", group.payee, month)) continue;

      yield* insertFeedEvent(sql, {
        id: yield* mintId(FeedEventId),
        origin: "money",
        category: "money_tax",
        eventType: "recurring_price_change",
        severity: "notice",
        summary: `${group.payee} changed from ${BigDecimal.format(group.priceChange.from)} to ${BigDecimal.format(group.priceChange.to)}`,
        payload: {
          payee: group.payee,
          month,
          from: BigDecimal.format(group.priceChange.from),
          to: BigDecimal.format(group.priceChange.to),
          on: group.priceChange.on,
        },
        links: null,
      });
    }
  }).pipe(Effect.asVoid);

import { FeedEventView, NotFound } from "@ironcage/contracts/schema";
import { FeedEventId, monthOf, type RequestId, type Sha256 } from "@ironcage/domain";
import { BigDecimal, Effect, Schema } from "effect";

import { mintId } from "../ids";
import { runIdempotentMutation } from "../persistence/app-requests";
import { persistenceToBoundary, type PersistenceError } from "../persistence/error";
import { decodeRows, Postgres, type SqlExecutor } from "../persistence/postgres";
import { computeAnomalies, computeMonths, computeRecurring, loadSplitLines } from "./analysis";
import type { CoveredSpan } from "./coverage";
import { loadCoverageSummary } from "./queries";
import { insertFeedEvent, type AccountRow } from "./store";

const FeedEventRow = Schema.Struct({
  id: FeedEventId,
  occurredAt: Schema.DateTimeUtcFromDate,
  origin: Schema.String,
  category: Schema.String,
  eventType: Schema.String,
  severity: Schema.Literals(["info", "notice", "warning", "critical"]),
  summary: Schema.String,
  payload: Schema.Unknown,
  links: Schema.NullOr(Schema.Unknown),
  acknowledgedAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
});

const feedColumns = `e.id, e.occurred_at AS "occurredAt", e.origin, e.category,
  e.event_type AS "eventType", e.severity, e.summary, e.payload, e.links,
  a.acknowledged_at AS "acknowledgedAt"`;

export const getFeed = (input: {
  readonly cursor: FeedEventId | null;
  readonly categories: readonly string[];
  readonly severities: readonly string[];
  readonly limit: number;
}) =>
  Effect.gen(function* () {
    const postgres = yield* Postgres;
    const limit = Math.min(Math.max(input.limit, 1), 200);

    const rows = yield* postgres.readTransaction((sql) =>
      sql.query(
        "read feed",
        `SELECT ${feedColumns}
           FROM feed_events e
           LEFT JOIN acknowledgments a ON a.event_id = e.id
          WHERE ($1::uuid IS NULL OR e.id < $1)
            AND (cardinality($2::text[]) = 0 OR e.category = ANY($2))
            AND (cardinality($3::text[]) = 0 OR e.severity = ANY($3))
          ORDER BY e.id DESC
          LIMIT ${limit}`,
        [input.cursor, [...input.categories], [...input.severities]],
      ),
    );
    const events = yield* decodeRows("decode feed events", FeedEventRow, rows);

    return {
      events,
      nextCursor: events.length === limit ? events[events.length - 1]!.id : null,
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
        yield* sql.query(
          "insert acknowledgment",
          `INSERT INTO acknowledgments (event_id, acknowledged_at)
           VALUES ($1, now()) ON CONFLICT (event_id) DO NOTHING`,
          [input.eventId],
        );
        const rows = yield* sql.query(
          "read acknowledged event",
          `SELECT ${feedColumns}
             FROM feed_events e LEFT JOIN acknowledgments a ON a.event_id = e.id
            WHERE e.id = $1`,
          [input.eventId],
        );
        const events = yield* decodeRows("decode feed event", FeedEventRow, rows);
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
    sql.query(
      "check derived event dedupe",
      `SELECT 1 FROM feed_events
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
): Effect.Effect<void, PersistenceError> =>
  Effect.gen(function* () {
    if (touchedMonths.size === 0) return;

    const coverage = yield* loadCoverageSummary(sql);
    const lines = yield* loadSplitLines(sql);
    const complete = new Set(coverage.completeMonths);
    const months = computeMonths(lines, complete);

    const anomalies = computeAnomalies(lines, months, complete).filter((anomaly) =>
      touchedMonths.has(anomaly.month),
    );
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

    if (coverage.dataThrough === null) return;
    const recurring = computeRecurring(lines, coverage.dataThrough);
    for (const group of recurring) {
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

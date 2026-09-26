import {
  Basis,
  BriefingSections,
  BriefingSummary,
  Figure,
  Limit,
  RecordRef,
} from "@repo/contracts/analyst";
import { Instant, YearMonth } from "@repo/contracts/finance";
import { DateTime, Effect, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql";

// What a written briefing shows, and the fingerprint of the facts it was written from. JSON
// columns hold the contract's JSON encoding.
const Written = Schema.Struct({
  fingerprint: Schema.String,
  sections: Schema.fromJsonString(Schema.toCodecJson(BriefingSections)),
  figures: Schema.fromJsonString(Schema.toCodecJson(Schema.Array(Figure))),
  records: Schema.fromJsonString(Schema.toCodecJson(Schema.Array(RecordRef))),
  basis: Schema.NullOr(Schema.fromJsonString(Schema.toCodecJson(Basis))),
  limits: Schema.fromJsonString(Schema.toCodecJson(Schema.Array(Limit))),
});
export type WrittenBriefing = typeof Written.Type;

const WaitingRow = Schema.Struct({
  month: YearMonth,
  status: Schema.Literals(["queued", "writing"]),
  attempts: Schema.Int,
});
const ReadyRow = Schema.Struct({
  month: YearMonth,
  status: Schema.Literal("ready"),
  ...Written.fields,
  writtenAt: Instant,
});
const BlockedRow = Schema.Struct({ month: YearMonth, status: Schema.Literal("blocked") });
const BriefingRow = Schema.Union([
  ReadyRow,
  WaitingRow,
  BlockedRow,
  Schema.Struct({ month: YearMonth, status: Schema.Literal("failed"), failure: Schema.String }),
]);
const ExistsRow = Schema.Struct({ exists: Schema.BooleanFromBit });
// A written briefing, or one the analyst was blocked from writing, which a read can queue
// again.
export type RewritableBriefing = typeof ReadyRow.Type | typeof BlockedRow.Type;

// How a write ended. A blocked write keeps no reason, which the allowance gives when the
// briefing is read.
export type BriefingOutcome =
  | { readonly status: "blocked" }
  | { readonly status: "failed"; readonly failure: string }
  | { readonly status: "ready"; readonly written: WrittenBriefing };

const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));

// A briefing waiting to be written holds nothing an earlier write left, and its write has
// not started.
const queued = (sql: SqlClient.SqlClient) => sql`status = 'queued', fingerprint = NULL,
  sections = NULL, figures = NULL, records = NULL, basis = NULL, limits = NULL,
  written_at = NULL, failure = NULL, attempts = 0`;

export const readBriefing = Effect.fn("readBriefing")(function* (month: YearMonth) {
  const sql = yield* SqlClient.SqlClient;
  const [briefing] =
    yield* sql`SELECT month, status, fingerprint, sections, figures, records, basis, limits,
      written_at AS "writtenAt", failure, attempts FROM briefings WHERE month = ${month}`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(BriefingRow))),
    );
  return briefing;
});

// The latest months first. A write that waits or runs shows as `writing`.
export const readBriefingSummaries = Effect.fn("readBriefingSummaries")(function* (limit: number) {
  const sql = yield* SqlClient.SqlClient;
  return yield* sql`SELECT month,
      CASE WHEN status IN ('queued', 'writing') THEN 'writing' ELSE status END AS status,
      written_at AS "writtenAt"
    FROM briefings ORDER BY month DESC LIMIT ${limit}`.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(BriefingSummary))),
  );
});

// Queues the month's first write, unless something already queued or wrote it. Returns
// whether it did.
export const insertBriefing = Effect.fn("insertBriefing")(function* (month: YearMonth) {
  const sql = yield* SqlClient.SqlClient;
  const inserted = yield* sql`INSERT INTO briefings (month, status) VALUES (${month}, 'queued')
    ON CONFLICT (month) DO NOTHING RETURNING month`;
  return inserted.length > 0;
});

// Queues a write of the month, unless one waits or runs already.
export const queueBriefing = Effect.fn("queueBriefing")(function* (month: YearMonth) {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`INSERT INTO briefings (month, status) VALUES (${month}, 'queued')
    ON CONFLICT (month) DO UPDATE SET ${queued(sql)}
    WHERE briefings.status IN ('ready', 'blocked', 'failed')`;
});

// Queues the month's write again, unless the briefing changed since it was read as `read`:
// blocked, or ready with the fingerprint of the facts it was written from. Returns whether
// it did.
export const queueRewrite = Effect.fn("queueRewrite")(function* (read: RewritableBriefing) {
  const sql = yield* SqlClient.SqlClient;
  const unchanged =
    read.status === "ready"
      ? sql`status = 'ready' AND fingerprint = ${read.fingerprint}`
      : sql`status = 'blocked'`;
  const updated = yield* sql`UPDATE briefings SET ${queued(sql)}
    WHERE month = ${read.month} AND ${unchanged} RETURNING month`;
  return updated.length > 0;
});

// A write an earlier run left writing comes first, then the latest queued month.
export const readNextBriefing = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const [briefing] = yield* sql`SELECT month, status, attempts FROM briefings
    WHERE status IN ('queued', 'writing')
    ORDER BY status = 'writing' DESC, month DESC LIMIT 1`.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(WaitingRow))),
  );
  return briefing;
});

export const readBriefingsWaiting = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const [waiting] =
    yield* sql`SELECT EXISTS (SELECT 1 FROM briefings WHERE status IN ('queued', 'writing')) AS "exists"`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Tuple([ExistsRow]))),
    );
  return waiting.exists;
});

// Starts an attempt at the month's write. Returns its number, from 1.
export const startBriefing = Effect.fn("startBriefing")(function* (month: YearMonth) {
  const sql = yield* SqlClient.SqlClient;
  const [started] = yield* sql`UPDATE briefings SET status = 'writing', attempts = attempts + 1
    WHERE month = ${month} RETURNING attempts`.pipe(
    Effect.flatMap(
      Schema.decodeUnknownEffect(Schema.Tuple([Schema.Struct({ attempts: Schema.Int })])),
    ),
  );
  return started.attempts;
});

export const finishBriefing = Effect.fn("finishBriefing")(function* (
  month: YearMonth,
  outcome: BriefingOutcome,
) {
  const sql = yield* SqlClient.SqlClient;
  if (outcome.status === "blocked") {
    yield* sql`UPDATE briefings SET status = 'blocked' WHERE month = ${month}`;
    return;
  }
  if (outcome.status === "failed") {
    yield* sql`UPDATE briefings SET status = 'failed', failure = ${outcome.failure}
      WHERE month = ${month}`;
    return;
  }
  const written = yield* Schema.encodeEffect(Written)(outcome.written);
  yield* sql`UPDATE briefings SET status = 'ready', fingerprint = ${written.fingerprint},
    sections = ${written.sections}, figures = ${written.figures}, records = ${written.records},
    basis = ${written.basis}, limits = ${written.limits}, written_at = ${yield* now}
    WHERE month = ${month}`;
});

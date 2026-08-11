import { Schema } from "effect";

import { uuidV7 } from "../values/uuid";

export const FeedEventId = uuidV7("FeedEventId");
export type FeedEventId = typeof FeedEventId.Type;

export const FeedEventType = Schema.Literals([
  "bank_import_completed",
  "bank_gap_detected",
  "bank_gap_closed",
  "recurring_price_change",
  "spending_anomaly",
  "report_generated",
  "report_failed",
  "ai_run_failed",
  "decision_record_lost",
]);
export type FeedEventType = typeof FeedEventType.Type;

export const FeedSeverity = Schema.Literals(["info", "notice", "warning", "critical"]);
export type FeedSeverity = typeof FeedSeverity.Type;

export const FeedEvent = Schema.Struct({
  id: FeedEventId,
  occurredAt: Schema.DateTimeUtcFromString,
  origin: Schema.String,
  category: Schema.String,
  eventType: FeedEventType,
  severity: FeedSeverity,
  summary: Schema.String,
  payload: Schema.Record(Schema.String, Schema.Unknown),
  links: Schema.NullOr(Schema.Record(Schema.String, Schema.String)),
  acknowledgedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
});
export type FeedEvent = typeof FeedEvent.Type;

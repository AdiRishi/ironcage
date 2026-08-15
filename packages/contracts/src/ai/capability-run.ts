import {
  CategorizationBatchItem,
  CategorizationCategory,
  CategorizationOutput,
  Instant,
  RunId,
  Sha256,
  SleeveId,
  categorizationCapability,
} from "@ironcage/domain";
import { Schema } from "effect";

/**
 * A run failure the producer records instead of an output. The failure is
 * itself the delivery: the consumer stores it and the safe default applies.
 */
export const FailureDetail = Schema.Struct({
  reason: Schema.String,
  detail: Schema.String,
});
export type FailureDetail = typeof FailureDetail.Type;

export const DecisionRecordBody = Schema.Struct({
  asked: Schema.String,
  inputsSummary: Schema.Unknown,
  decided: Schema.Unknown,
  rationale: Schema.String,
  model: Schema.String,
  gatewayLogIds: Schema.Array(Schema.String),
  otelTraceId: Schema.NullOr(Schema.String),
  otelParentSpanIds: Schema.Array(Schema.String),
});
export type DecisionRecordBody = typeof DecisionRecordBody.Type;

export const CategorizationDispatch = Schema.Struct({
  runId: RunId,
  restart: Schema.Boolean,
  attempt: Schema.Int,
  configVersion: Schema.Int,
  bundleDigest: Sha256,
  batchIndex: Schema.Int,
  inputDigest: Sha256,
  model: Schema.String,
  batch: Schema.Array(CategorizationBatchItem),
  categories: Schema.Array(CategorizationCategory),
});
export type CategorizationDispatch = typeof CategorizationDispatch.Type;

/**
 * The one message shape the decision-records queue accepts. The run ID is
 * the application idempotency key backed by `queue_dedupe`; Queues itself
 * does not dedupe on it.
 */
export const CapabilityRunMessage = Schema.Struct({
  runId: RunId,
  capability: Schema.Literal(categorizationCapability.name),
  sleeveId: Schema.NullOr(SleeveId),
  configVersion: Schema.Int,
  trigger: Schema.Union([
    Schema.Struct({ _tag: Schema.Literal("schedule"), scheduledAt: Instant }),
    Schema.Struct({
      _tag: Schema.Literal("batch"),
      bundleDigest: Sha256,
      batchIndex: Schema.Int,
      inputDigest: Sha256,
    }),
  ]),
  producedAt: Instant,
  result: Schema.Union([
    Schema.Struct({ _tag: Schema.Literal("Output"), output: Schema.Unknown }),
    Schema.Struct({ _tag: Schema.Literal("Failed"), failure: FailureDetail }),
  ]),
  decisionRecord: DecisionRecordBody,
});
export type CapabilityRunMessage = typeof CapabilityRunMessage.Type;

export {
  CategorizationBatchItem,
  CategorizationCategory,
  CategorizationOutput,
  categorizationCapability,
};

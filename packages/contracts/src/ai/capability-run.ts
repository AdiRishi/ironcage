import {
  Aud,
  BankTransactionId,
  CategoryId,
  Instant,
  RunId,
  Sha256,
  SleeveId,
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
  otelTraceId: Schema.String,
  otelParentSpanIds: Schema.Array(Schema.String),
});
export type DecisionRecordBody = typeof DecisionRecordBody.Type;

/**
 * The one message shape the decision-records queue accepts. The run ID is
 * the application idempotency key backed by `queue_dedupe`; Queues itself
 * does not dedupe on it.
 */
export const CapabilityRunMessage = Schema.Struct({
  runId: RunId,
  capability: Schema.String,
  sleeveId: Schema.NullOr(SleeveId),
  configVersion: Schema.Int,
  trigger: Schema.Union([
    Schema.Struct({ _tag: Schema.Literal("schedule"), scheduledAt: Instant }),
    Schema.Struct({ _tag: Schema.Literal("batch"), bundleDigest: Sha256, batchIndex: Schema.Int }),
  ]),
  producedAt: Instant,
  result: Schema.Union([
    Schema.Struct({ _tag: Schema.Literal("Output"), output: Schema.Unknown }),
    Schema.Struct({ _tag: Schema.Literal("Failed"), failure: FailureDetail }),
  ]),
  decisionRecord: DecisionRecordBody,
});
export type CapabilityRunMessage = typeof CapabilityRunMessage.Type;

/** Money's categorization capability, registered once. */
export const categorizationCapability = {
  name: "money.categorization",
  configVersion: 1,
  batchSize: 200,
} as const;

/** What one categorization run receives: normalized text, never raw pages. */
export const CategorizationBatchItem = Schema.Struct({
  transactionId: BankTransactionId,
  payee: Schema.String,
  narrative: Schema.String,
  amount: Aud,
  accountLabel: Schema.String,
});
export type CategorizationBatchItem = typeof CategorizationBatchItem.Type;

export const CategorizationCategory = Schema.Struct({
  id: CategoryId,
  name: Schema.String,
  kind: Schema.Literals(["expense", "income"]),
});
export type CategorizationCategory = typeof CategorizationCategory.Type;

/** The capability's registered output schema; core re-validates it. */
export const CategorizationOutput = Schema.Struct({
  suggestions: Schema.Array(
    Schema.Struct({
      transactionId: BankTransactionId,
      categoryId: CategoryId,
      rationale: Schema.String,
    }),
  ),
});
export type CategorizationOutput = typeof CategorizationOutput.Type;

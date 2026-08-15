import { CapabilityRunMessage } from "@ironcage/contracts/schema";
import {
  CategorizationBatchItem,
  CategorizationCategory,
  CategorizationOutput,
  FeedEventId,
  RunId,
  Sha256,
  categorizationCapability,
  deriveRunId,
  uncategorizedCategoryId,
} from "@ironcage/domain";
import { DateTime, Effect, Schema } from "effect";

import { mintId, mintUuidV7 } from "../ids";
import { insertFeedEvent } from "../money/feed/outbox";
import { sha256Hex } from "../money/import/bytes";
import { Postgres, type SqlExecutor } from "../persistence/postgres";

export type ConsumeOutcome =
  | { readonly kind: "accepted"; readonly filed: number }
  | { readonly kind: "failed_run" }
  | { readonly kind: "duplicate" }
  | { readonly kind: "collision" }
  | { readonly kind: "undecodable" };

const decodeMessage = Schema.decodeUnknownEffect(CapabilityRunMessage);
const decodeOutput = Schema.decodeUnknownEffect(CategorizationOutput);

const ExpectedBatchRow = Schema.Struct({
  runId: RunId,
  bundleDigest: Sha256,
  batchIndex: Schema.Int,
  configVersion: Schema.Int,
  inputDigest: Sha256,
  model: Schema.String,
  batch: Schema.Array(CategorizationBatchItem),
  categories: Schema.Array(CategorizationCategory),
});

type ExpectedBatch = typeof ExpectedBatchRow.Type;

const loadExpectedBatch = (sql: SqlExecutor, runId: RunId) =>
  Effect.gen(function* () {
    const rows = yield* sql.rows(
      "load expected categorization batch",
      ExpectedBatchRow,
      `SELECT b.run_id AS "runId", b.bundle_digest AS "bundleDigest",
              b.batch_index AS "batchIndex", b.config_version AS "configVersion",
              b.input_digest AS "inputDigest", c.model, b.batch, b.categories
         FROM categorization_batches b
         JOIN capability_configs c
           ON c.capability = $2 AND c.version = b.config_version
        WHERE b.run_id = $1`,
      [runId, categorizationCapability.name],
    );
    return rows[0] ?? null;
  });

const invalidAnchor = (
  message: typeof CapabilityRunMessage.Type,
  expected: ExpectedBatch | null,
): string | null => {
  if (expected === null) return "the run ID names no recorded categorization batch";
  if (message.sleeveId !== null) return "money categorization cannot be scoped to a sleeve";
  if (message.configVersion !== expected.configVersion) return "the configuration version changed";
  if (message.decisionRecord.model !== expected.model)
    return "the model differs from the run config";
  if (message.trigger._tag !== "batch") return "categorization requires a batch trigger";
  if (
    message.trigger.bundleDigest !== expected.bundleDigest ||
    message.trigger.batchIndex !== expected.batchIndex ||
    message.trigger.inputDigest !== expected.inputDigest
  ) {
    return "the trigger differs from the recorded batch";
  }
  if (
    deriveRunId(categorizationCapability.name, expected.configVersion, expected.inputDigest) !==
    message.runId
  ) {
    return "the run ID does not derive from the recorded input";
  }
  return null;
};

const invalidOutput = (output: CategorizationOutput, expected: ExpectedBatch): string | null => {
  if (output.suggestions.length !== expected.batch.length) {
    return "the answer does not cover the complete batch";
  }
  const expectedTransactions = new Set(expected.batch.map((item) => item.transactionId));
  const offeredCategories = new Set(expected.categories.map((category) => category.id));
  const answered = new Set<string>();
  for (const suggestion of output.suggestions) {
    if (!expectedTransactions.has(suggestion.transactionId)) {
      return `transaction ${suggestion.transactionId} is not in the recorded batch`;
    }
    if (answered.has(suggestion.transactionId)) {
      return `transaction ${suggestion.transactionId} appears more than once`;
    }
    if (!offeredCategories.has(suggestion.categoryId)) {
      return `category ${suggestion.categoryId} was not offered to the run`;
    }
    answered.add(suggestion.transactionId);
  }
  return null;
};

/**
 * The decision-records consumer: insert-first deduplication on the run ID,
 * hash comparison on redelivery, authoritative output validation, and one
 * transaction for the dedupe row, output, decision record, the applied
 * splits, and any feed event. An undecodable body follows the queue's retry path; a
 * same-ID different-hash collision keeps the stored original and raises a
 * critical event.
 */
export const consumeCapabilityRun = (
  body: unknown,
): Effect.Effect<ConsumeOutcome, unknown, Postgres> =>
  Effect.gen(function* () {
    const decoded = yield* Effect.result(decodeMessage(body));
    if (decoded._tag === "Failure") return { kind: "undecodable" } as const;
    const message = decoded.success;

    const payloadHash = yield* Effect.promise(() =>
      sha256Hex(new TextEncoder().encode(JSON.stringify(body))),
    );

    const postgres = yield* Postgres;
    return yield* postgres.transaction((sql) =>
      Effect.gen(function* () {
        const inserted = yield* sql.rows(
          "insert queue dedupe",
          Schema.Struct({ runId: RunId }),
          `INSERT INTO queue_dedupe (run_id, payload_hash, consumed_at)
           VALUES ($1, $2, now()) ON CONFLICT (run_id) DO NOTHING RETURNING run_id AS "runId"`,
          [message.runId, payloadHash],
        );
        if (inserted.length === 0) {
          const stored = yield* sql.rows(
            "read queue dedupe",
            Schema.Struct({ hash: Sha256 }),
            "SELECT payload_hash AS hash FROM queue_dedupe WHERE run_id = $1",
            [message.runId],
          );
          if (stored[0]?.hash === payloadHash) return { kind: "duplicate" } as const;

          // Two executions claimed one identity: a producer is broken. Keep
          // the stored original and raise the defect loudly.
          yield* insertFeedEvent(sql, {
            id: yield* mintId(FeedEventId),
            origin: "system",
            category: "system",
            eventType: "decision_record_lost",
            severity: "critical",
            summary: `run ${message.runId} redelivered with different content`,
            payload: { runId: message.runId, capability: message.capability },
            links: null,
          });
          return { kind: "collision" } as const;
        }

        const expected = yield* loadExpectedBatch(sql, message.runId);
        const anchorFailure = invalidAnchor(message, expected);

        let output: CategorizationOutput | null = null;
        let failure: unknown = null;

        if (expected === null || anchorFailure !== null) {
          failure = {
            reason: "InvalidAnchor",
            detail: anchorFailure,
          };
        } else if (message.result._tag === "Failed") {
          failure = message.result.failure;
        } else {
          const validated = yield* Effect.result(decodeOutput(message.result.output));
          if (validated._tag === "Failure") {
            failure = {
              reason: "OutputSchemaMismatch",
              detail: "output failed authoritative validation",
            };
          } else {
            const outputFailure = invalidOutput(validated.success, expected);
            if (outputFailure === null) output = validated.success;
            else failure = { reason: "InvalidOutput", detail: outputFailure };
          }
        }

        yield* sql.execute(
          "insert capability output",
          `INSERT INTO capability_outputs
             (run_id, capability, sleeve_id, trigger, scheduled_at, output, failure, payload_hash, config_version, produced_at, valid_until)
           VALUES ($1, $2, $3, $4::jsonb, NULL, $5::jsonb, $6::jsonb, $7, $8, $9, NULL)`,
          [
            message.runId,
            message.capability,
            message.sleeveId,
            JSON.stringify(message.trigger),
            output === null ? null : JSON.stringify(output),
            failure === null ? null : JSON.stringify(failure),
            payloadHash,
            message.configVersion,
            DateTime.formatIso(message.producedAt),
          ],
        );

        const decisionRecordId = mintUuidV7();
        yield* sql.execute(
          "insert decision record",
          `INSERT INTO decision_records
             (id, capability, asked, inputs_summary, decided, rationale, model, config_version, gateway_log_ids, otel_trace_id, otel_parent_span_ids, occurred_at)
           VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9, $10, $11, now())`,
          [
            decisionRecordId,
            message.capability,
            message.decisionRecord.asked,
            JSON.stringify(message.decisionRecord.inputsSummary),
            JSON.stringify(message.decisionRecord.decided),
            message.decisionRecord.rationale,
            message.decisionRecord.model,
            message.configVersion,
            [...message.decisionRecord.gatewayLogIds],
            message.decisionRecord.otelTraceId,
            [...message.decisionRecord.otelParentSpanIds],
          ],
        );

        if (output === null) {
          yield* insertFeedEvent(sql, {
            id: yield* mintId(FeedEventId),
            origin: "money",
            category: "system",
            eventType: "ai_run_failed",
            severity: "warning",
            summary: `categorization run ${message.runId} failed; its rows stay uncategorized`,
            payload: { runId: message.runId, failure },
            links: null,
          });
          return { kind: "failed_run" } as const;
        }

        // The model's answer becomes the effective split — but only for a
        // transaction still sitting uncategorized. A row a rule or the
        // operator filed meanwhile is theirs; the model never overwrites it.
        let landed = 0;
        for (const suggestion of output.suggestions) {
          const applied = yield* sql.rows(
            "apply ai categorization",
            Schema.Struct({ id: Schema.String }),
            `WITH target AS (
               SELECT t.id, t.amount,
                      (SELECT max(revision) FROM transaction_splits s WHERE s.transaction_id = t.id) AS revision
                 FROM bank_transactions t
                WHERE t.id = $1
                  AND EXISTS (
                        SELECT 1 FROM transaction_splits s
                         WHERE s.transaction_id = t.id
                           AND s.revision = (SELECT max(revision) FROM transaction_splits latest
                                              WHERE latest.transaction_id = t.id)
                           AND s.category_id = $2
                      )
             ),
             split AS (
               INSERT INTO transaction_splits (id, transaction_id, revision, category_id, amount, provenance, rule_id, created_at)
               SELECT $3, id, revision + 1, $4, amount, 'ai', NULL, now() FROM target
               RETURNING transaction_id
             )
             INSERT INTO categorization_assignments
               (id, run_id, transaction_id, category_id, rationale, decision_record_id, status, created_at)
             SELECT $5, $6, transaction_id, $4, $7, $8, 'applied', now() FROM split
             RETURNING id`,
            [
              suggestion.transactionId,
              uncategorizedCategoryId,
              mintUuidV7(),
              suggestion.categoryId,
              mintUuidV7(),
              message.runId,
              suggestion.rationale,
              decisionRecordId,
            ],
          );
          landed += applied.length;
        }

        if (landed > 0) {
          yield* insertFeedEvent(sql, {
            id: yield* mintId(FeedEventId),
            origin: "money",
            category: "money_tax",
            eventType: "ai_categorized",
            severity: "info",
            summary: `AI filed ${landed} of ${output.suggestions.length} transactions in batch ${message.trigger._tag === "batch" ? message.trigger.batchIndex : 0}`,
            payload: { runId: message.runId, filed: landed, answered: output.suggestions.length },
            links: null,
          });
        }

        return { kind: "accepted", filed: landed } as const;
      }),
    );
  });

/**
 * The dead-letter consumer: a message that exhausted its deliveries becomes a
 * permanent `decision_record_lost` warning, idempotent on the message ID.
 */
export const consumeDeadLetter = (
  messageId: string,
  body: unknown,
): Effect.Effect<void, unknown, Postgres> =>
  Effect.gen(function* () {
    const postgres = yield* Postgres;
    yield* postgres.transaction((sql) =>
      Effect.gen(function* () {
        const existing = yield* sql.rows(
          "check dead letter dedupe",
          Schema.Struct({ exists: Schema.Int }),
          `SELECT 1 AS exists FROM feed_events
            WHERE event_type = 'decision_record_lost' AND payload->>'messageId' = $1`,
          [messageId],
        );
        if (existing.length > 0) return;

        yield* insertFeedEvent(sql, {
          id: yield* mintId(FeedEventId),
          origin: "system",
          category: "system",
          eventType: "decision_record_lost",
          severity: "warning",
          summary: "a capability run exhausted its deliveries and was dead-lettered",
          payload: { messageId, body },
          links: null,
        });
      }),
    );
  }).pipe(Effect.asVoid);

import {
  CapabilityRunMessage,
  categorizationCapability,
  CategorizationOutput,
} from "@ironcage/contracts/schema";
import { FeedEventId, uncategorizedCategoryId } from "@ironcage/domain";
import { DateTime, Effect, Schema } from "effect";

import { mintId, mintRawUuidV7 } from "../ids";
import { sha256Hex } from "../money/bytes";
import { insertFeedEvent } from "../money/store";
import { Postgres, type SqlExecutor } from "../persistence/postgres";

export type ConsumeOutcome =
  | { readonly kind: "accepted"; readonly filed: number }
  | { readonly kind: "failed_run" }
  | { readonly kind: "duplicate" }
  | { readonly kind: "collision" }
  | { readonly kind: "undecodable" };

const decodeMessage = Schema.decodeUnknownEffect(CapabilityRunMessage);
const decodeOutput = Schema.decodeUnknownEffect(CategorizationOutput);

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
        const inserted = yield* sql.query(
          "insert queue dedupe",
          `INSERT INTO queue_dedupe (run_id, payload_hash, consumed_at)
           VALUES ($1, $2, now()) ON CONFLICT (run_id) DO NOTHING RETURNING run_id`,
          [message.runId, payloadHash],
        );
        if (inserted.length === 0) {
          const stored = yield* sql.query(
            "read queue dedupe",
            "SELECT payload_hash AS hash FROM queue_dedupe WHERE run_id = $1",
            [message.runId],
          );
          if (stored[0]?.["hash"] === payloadHash) return { kind: "duplicate" } as const;

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

        // The batch anchor must name work that exists.
        const anchorValid =
          message.trigger._tag === "batch"
            ? (yield* sql.query(
                "check batch anchor",
                "SELECT 1 FROM bank_imports WHERE bundle_digest = $1",
                [message.trigger.bundleDigest],
              )).length > 0
            : false;

        let output: CategorizationOutput | null = null;
        let failure: unknown = null;

        if (!anchorValid) {
          failure = {
            reason: "InvalidAnchor",
            detail: "the batch anchor names no recorded import",
          };
        } else if (message.result._tag === "Failed") {
          failure = message.result.failure;
        } else if (message.capability !== categorizationCapability.name) {
          failure = { reason: "UnknownCapability", detail: message.capability };
        } else {
          const validated = yield* Effect.result(decodeOutput(message.result.output));
          if (validated._tag === "Failure") {
            failure = {
              reason: "OutputSchemaMismatch",
              detail: "output failed authoritative validation",
            };
          } else {
            output = validated.success;
          }
        }

        yield* sql.query(
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

        const decisionRecordId = mintRawUuidV7();
        yield* sql.query(
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
          const applied = yield* sql.query(
            "apply ai categorization",
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
              mintRawUuidV7(),
              suggestion.categoryId,
              mintRawUuidV7(),
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
        const existing = yield* sql.query(
          "check dead letter dedupe",
          `SELECT 1 FROM feed_events
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

/** One batch per confirmed import chunk; dispatch failures are missed runs. */
export const loadCategorizationBatches = (
  sql: SqlExecutor,
  bundleDigest: string,
): Effect.Effect<
  ReadonlyArray<{
    readonly batch: ReadonlyArray<{
      readonly transactionId: string;
      readonly payee: string;
      readonly narrative: string;
      readonly amount: string;
      readonly accountLabel: string;
    }>;
  }>,
  unknown
> =>
  Effect.gen(function* () {
    const rows = yield* sql.query(
      "load uncategorized transactions for dispatch",
      `SELECT t.id AS "transactionId", t.derived_payee AS payee, t.display_narrative AS narrative,
              t.amount::text AS amount, a.product_label AS "accountLabel"
         FROM bank_transactions t
         JOIN bank_accounts a ON a.id = t.account_id
         JOIN bank_imports i ON i.id = t.created_by_import
        WHERE i.bundle_digest = $1
          AND EXISTS (SELECT 1 FROM transaction_splits s
                       WHERE s.transaction_id = t.id
                         AND s.revision = (SELECT max(revision) FROM transaction_splits latest
                                            WHERE latest.transaction_id = t.id)
                         AND s.category_id = $2)
        ORDER BY t.posted_date, t.id`,
      [bundleDigest, uncategorizedCategoryId],
    );

    const items = rows.map((row) => ({
      transactionId: String(row["transactionId"]),
      payee: String(row["payee"]),
      narrative: String(row["narrative"]),
      amount: String(row["amount"]),
      accountLabel: String(row["accountLabel"]),
    }));
    const batches: { batch: typeof items }[] = [];
    for (let index = 0; index < items.length; index += categorizationCapability.batchSize) {
      batches.push({ batch: items.slice(index, index + categorizationCapability.batchSize) });
    }
    return batches;
  });

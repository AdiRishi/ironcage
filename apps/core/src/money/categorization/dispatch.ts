import {
  CategorizationDispatch as CategorizationDispatchSchema,
  CategorizationBatchItem,
  CategorizationCategory,
  RetryCategorizationResult,
  type CategorizationDispatch as CategorizationDispatchPayload,
} from "@ironcage/contracts/schema";
import {
  BankImportId,
  BankTransactionId,
  RunId,
  Sha256,
  categorizationCapability,
  deriveRunId,
  uncategorizedCategoryId,
  type RequestId,
  type Sha256 as Sha256Type,
} from "@ironcage/domain";
import { BigDecimal, Effect, Schema } from "effect";

import type { PersistenceError, SqlExecutor } from "../../persistence";
import { runIdempotentMutation } from "../../persistence/app-requests";
import { sha256Hex } from "../import/bytes";
import type { ConfirmedImportGraph } from "../import/store";

export type CategorizationDispatch = CategorizationDispatchPayload;

export interface RetryCategorizationInput {
  readonly requestId: RequestId;
  readonly payloadHash: Sha256Type;
}

const CapabilityConfigRow = Schema.Struct({
  version: Schema.Int,
  model: Schema.String,
  enabled: Schema.Boolean,
});

const AccountLabelRow = Schema.Struct({ label: Schema.String });

const RetrySourceBatchRow = Schema.Struct({
  runId: RunId,
  importId: BankImportId,
  bundleDigest: Sha256,
  batchIndex: Schema.Int,
  configVersion: Schema.Int,
  batch: Schema.Array(CategorizationBatchItem),
  unresolvedTransactionIds: Schema.Array(BankTransactionId),
});

const CapabilityOutputStateRow = Schema.Struct({ failed: Schema.Boolean });

const decodeSha = Schema.decodeUnknownSync(Sha256);
const encodeCategorizationBatchItem = Schema.encodeSync(CategorizationBatchItem);

interface CategorizationDigestInput {
  readonly batch: readonly ReturnType<typeof encodeCategorizationBatchItem>[];
  readonly categories: readonly CategorizationCategory[];
}

const inputDigest = (input: CategorizationDigestInput) =>
  Effect.promise(() => sha256Hex(new TextEncoder().encode(JSON.stringify(input)))).pipe(
    Effect.map(decodeSha),
  );

interface CategorizationBatchRecord {
  readonly runId: RunId;
  readonly importId: BankImportId;
  readonly bundleDigest: Sha256Type;
  readonly batchIndex: number;
  readonly configVersion: number;
  readonly inputDigest: Sha256Type;
  readonly batch: readonly CategorizationBatchItem[];
  readonly categories: readonly CategorizationCategory[];
}

const insertCategorizationBatch = Effect.fn("insertCategorizationBatch")(function* (
  sql: SqlExecutor,
  record: CategorizationBatchRecord,
) {
  const encodedBatch = record.batch.map((item) => encodeCategorizationBatchItem(item));

  yield* sql.execute(
    "insert categorization batch",
    `INSERT INTO categorization_batches
         (run_id, import_id, capability, bundle_digest, batch_index, config_version, input_digest,
          batch, categories, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, now())
       ON CONFLICT (run_id) DO NOTHING`,
    [
      record.runId,
      record.importId,
      categorizationCapability.name,
      record.bundleDigest,
      record.batchIndex,
      record.configVersion,
      record.inputDigest,
      JSON.stringify(encodedBatch),
      JSON.stringify(record.categories),
    ],
  );
  yield* sql.execute(
    "insert categorization batch transactions",
    `INSERT INTO categorization_batch_transactions (run_id, transaction_id, ordinal)
       SELECT $1, x.transaction_id::uuid, x.ordinal
         FROM jsonb_to_recordset($2::jsonb) AS x(transaction_id text, ordinal integer)
       ON CONFLICT DO NOTHING`,
    [
      record.runId,
      JSON.stringify(
        record.batch.map((item, ordinal) => ({ transaction_id: item.transactionId, ordinal })),
      ),
    ],
  );
  yield* sql.execute(
    "insert categorization batch categories",
    `INSERT INTO categorization_batch_categories (run_id, category_id)
       SELECT $1, value::uuid FROM jsonb_array_elements_text($2::jsonb)
       ON CONFLICT DO NOTHING`,
    [record.runId, JSON.stringify(record.categories.map((category) => category.id))],
  );
  yield* sql.execute(
    "enqueue categorization dispatch",
    `INSERT INTO capability_dispatches
         (run_id, status, attempt_count, last_error, created_at, dispatched_at)
       VALUES ($1, 'pending', 0, NULL, now(), NULL)
       ON CONFLICT (run_id) DO NOTHING`,
    [record.runId],
  );
});

export const enqueueCategorizationBatches = Effect.fn("enqueueCategorizationBatches")(function* (
  sql: SqlExecutor,
  graph: ConfirmedImportGraph,
): Effect.fn.Return<number, PersistenceError> {
  const configRows = yield* sql.rows(
    "read categorization capability config",
    CapabilityConfigRow,
    `SELECT version, model, enabled
         FROM capability_configs
        WHERE capability = $1 AND version = $2`,
    [categorizationCapability.name, categorizationCapability.configVersion],
  );
  const config = configRows[0];
  if (config === undefined || !config.enabled) return 0;

  const categories = yield* sql.rows(
    "list categories offered to categorization",
    CategorizationCategory,
    `SELECT id, name, kind
         FROM categories
        WHERE system = false AND archived = false
        ORDER BY id`,
  );
  const accountRows = yield* sql.rows(
    "read account label for categorization",
    AccountLabelRow,
    "SELECT product_label AS label FROM bank_accounts WHERE id = $1",
    [graph.importRow.accountId],
  );
  const account = accountRows[0]!;
  const uncategorized = new Set(
    graph.splits
      .filter((split) => split.categoryId === uncategorizedCategoryId)
      .map((split) => split.transactionId),
  );
  const items = graph.transactions
    .filter((transaction) => uncategorized.has(transaction.id))
    .map((transaction): CategorizationBatchItem => ({
      transactionId: transaction.id,
      payee: transaction.derivedPayee,
      narrative: transaction.displayNarrative,
      amount: Schema.decodeUnknownSync(CategorizationBatchItem.fields.amount)(
        BigDecimal.format(BigDecimal.normalize(transaction.amount)),
      ),
      accountLabel: account.label,
    }));

  if (items.length === 0 || categories.length === 0) return 0;

  let batchCount = 0;
  for (let offset = 0; offset < items.length; offset += categorizationCapability.batchSize) {
    const batchIndex = batchCount;
    const batch = items.slice(offset, offset + categorizationCapability.batchSize);
    const encodedBatch = batch.map((item) => encodeCategorizationBatchItem(item));
    const digest = yield* inputDigest({ batch: encodedBatch, categories });
    const runId = deriveRunId(categorizationCapability.name, config.version, digest);

    yield* insertCategorizationBatch(sql, {
      runId,
      importId: graph.importRow.id,
      bundleDigest: graph.importRow.bundleDigest,
      batchIndex,
      configVersion: config.version,
      inputDigest: digest,
      batch,
      categories,
    });
    batchCount += 1;
  }

  return batchCount;
});

export const listPendingCategorizationDispatches = (
  sql: SqlExecutor,
  limit: number,
): Effect.Effect<readonly CategorizationDispatchPayload[], PersistenceError> =>
  sql.rows(
    "list pending categorization dispatches",
    CategorizationDispatchSchema,
    `SELECT b.run_id AS "runId", d.restart_requested AS restart,
              d.attempt_count AS attempt,
              b.config_version AS "configVersion",
              b.bundle_digest AS "bundleDigest", b.batch_index AS "batchIndex",
              b.input_digest AS "inputDigest", c.model, b.batch, b.categories
         FROM capability_dispatches d
         JOIN categorization_batches b ON b.run_id = d.run_id
         JOIN capability_configs c
           ON c.capability = $1 AND c.version = b.config_version
        WHERE d.status = 'pending'
        ORDER BY d.created_at
        LIMIT $2`,
    [categorizationCapability.name, limit],
  );

export const markCategorizationDispatched = (
  sql: SqlExecutor,
  runId: RunId,
): Effect.Effect<void, PersistenceError> =>
  sql.execute(
    "mark categorization dispatch complete",
    `UPDATE capability_dispatches
          SET status = 'dispatched', attempt_count = attempt_count + 1,
              restart_requested = false, last_error = NULL, dispatched_at = now()
        WHERE run_id = $1 AND status = 'pending'`,
    [runId],
  );

export const recordCategorizationDispatchFailure = (
  sql: SqlExecutor,
  runId: RunId,
  detail: string,
): Effect.Effect<void, PersistenceError> =>
  sql.execute(
    "record categorization dispatch failure",
    `UPDATE capability_dispatches
          SET last_error = $2
        WHERE run_id = $1 AND status = 'pending'`,
    [runId, detail.slice(0, 2_000)],
  );

const requeueRecordedBatch = Effect.fn("requeueRecordedCategorizationBatch")(function* (
  sql: SqlExecutor,
  runId: RunId,
) {
  const outputs = yield* sql.rows(
    "read categorization output state",
    CapabilityOutputStateRow,
    `SELECT failure IS NOT NULL AS failed
       FROM capability_outputs
      WHERE run_id = $1`,
    [runId],
  );
  const output = outputs[0];
  if (output !== undefined && !output.failed) return false;

  if (output?.failed) {
    yield* sql.execute(
      "clear categorization queue claim",
      "DELETE FROM queue_dedupe WHERE run_id = $1",
      [runId],
    );
    yield* sql.execute(
      "clear failed categorization output",
      "DELETE FROM capability_outputs WHERE run_id = $1 AND failure IS NOT NULL",
      [runId],
    );
  }

  yield* sql.execute(
    "requeue categorization dispatch",
    `UPDATE capability_dispatches
        SET restart_requested = restart_requested OR status = 'dispatched' OR $2,
            status = 'pending',
            last_error = NULL, dispatched_at = NULL
      WHERE run_id = $1`,
    [runId, output?.failed ?? false],
  );
  return true;
});

const requeueUncategorizedCategorization = Effect.fn("requeueUncategorizedCategorization")(
  function* (sql: SqlExecutor) {
    const configRows = yield* sql.rows(
      "read categorization capability config",
      CapabilityConfigRow,
      `SELECT version, model, enabled
         FROM capability_configs
        WHERE capability = $1 AND version = $2`,
      [categorizationCapability.name, categorizationCapability.configVersion],
    );
    const config = configRows[0];
    if (config === undefined || !config.enabled) return { transactions: 0, batches: 0 };

    const categories = yield* sql.rows(
      "list categories offered to retried categorization",
      CategorizationCategory,
      `SELECT id, name, kind
         FROM categories
        WHERE system = false AND archived = false
        ORDER BY id`,
    );
    if (categories.length === 0) return { transactions: 0, batches: 0 };

    const sources = yield* sql.rows(
      "list unresolved categorization batches",
      RetrySourceBatchRow,
      `WITH latest_batches AS (
         SELECT DISTINCT ON (import_id, batch_index)
                run_id, import_id, bundle_digest, batch_index, config_version, batch
           FROM categorization_batches
          ORDER BY import_id, batch_index, config_version DESC
       )
       SELECT batch.run_id AS "runId", batch.import_id AS "importId",
              batch.bundle_digest AS "bundleDigest", batch.batch_index AS "batchIndex",
              batch.config_version AS "configVersion", batch.batch,
              jsonb_agg(link.transaction_id ORDER BY link.ordinal) AS "unresolvedTransactionIds"
         FROM latest_batches batch
         JOIN categorization_batch_transactions link ON link.run_id = batch.run_id
         JOIN transaction_splits split ON split.transaction_id = link.transaction_id
        WHERE split.category_id = $1
          AND split.revision = (
            SELECT max(latest.revision)
              FROM transaction_splits latest
             WHERE latest.transaction_id = split.transaction_id
          )
        GROUP BY batch.run_id, batch.import_id, batch.bundle_digest, batch.batch_index,
                 batch.config_version, batch.batch
        ORDER BY batch.import_id, batch.batch_index`,
      [uncategorizedCategoryId],
    );

    const transactions = new Set<BankTransactionId>();
    let batches = 0;
    for (const source of sources) {
      let runId = source.runId;
      if (source.configVersion !== config.version) {
        const unresolved = new Set(source.unresolvedTransactionIds);
        const batch = source.batch.filter((item) => unresolved.has(item.transactionId));
        const encodedBatch = batch.map((item) => encodeCategorizationBatchItem(item));
        const digest = yield* inputDigest({ batch: encodedBatch, categories });
        runId = deriveRunId(categorizationCapability.name, config.version, digest);
        yield* insertCategorizationBatch(sql, {
          runId,
          importId: source.importId,
          bundleDigest: source.bundleDigest,
          batchIndex: source.batchIndex,
          configVersion: config.version,
          inputDigest: digest,
          batch,
          categories,
        });
      }

      if (!(yield* requeueRecordedBatch(sql, runId))) continue;
      source.unresolvedTransactionIds.forEach((transactionId) => transactions.add(transactionId));
      batches += 1;
    }

    return { transactions: transactions.size, batches };
  },
);

export const retryUncategorizedCategorization = (input: RetryCategorizationInput) =>
  runIdempotentMutation(
    {
      ...input,
      operation: "retryCategorization",
      response: RetryCategorizationResult,
    },
    requeueUncategorizedCategorization,
  );

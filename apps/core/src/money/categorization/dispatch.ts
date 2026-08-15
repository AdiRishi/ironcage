import {
  CategorizationDispatch as CategorizationDispatchSchema,
  CategorizationBatchItem,
  CategorizationCategory,
  type CategorizationDispatch as CategorizationDispatchPayload,
} from "@ironcage/contracts/schema";
import {
  RunId,
  Sha256,
  categorizationCapability,
  deriveRunId,
  uncategorizedCategoryId,
} from "@ironcage/domain";
import { BigDecimal, Effect, Schema } from "effect";

import type { PersistenceError, SqlExecutor } from "../../persistence";
import { sha256Hex } from "../import/bytes";
import type { ConfirmedImportGraph } from "../import/store";

export type CategorizationDispatch = CategorizationDispatchPayload;

const CapabilityConfigRow = Schema.Struct({
  version: Schema.Int,
  model: Schema.String,
  enabled: Schema.Boolean,
});

const AccountLabelRow = Schema.Struct({ label: Schema.String });

const decodeSha = Schema.decodeUnknownSync(Sha256);

const inputDigest = (input: unknown) =>
  Effect.promise(() => sha256Hex(new TextEncoder().encode(JSON.stringify(input)))).pipe(
    Effect.map(decodeSha),
  );

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
    const encodeItem = Schema.encodeSync(CategorizationBatchItem);
    const encodedBatch = batch.map((item) => encodeItem(item));
    const digest = yield* inputDigest({ batch: encodedBatch, categories });
    const runId = deriveRunId(categorizationCapability.name, config.version, digest);

    yield* sql.execute(
      "insert categorization batch",
      `INSERT INTO categorization_batches
           (run_id, import_id, capability, bundle_digest, batch_index, config_version, input_digest,
            batch, categories, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, now())`,
      [
        runId,
        graph.importRow.id,
        categorizationCapability.name,
        graph.importRow.bundleDigest,
        batchIndex,
        config.version,
        digest,
        JSON.stringify(encodedBatch),
        JSON.stringify(categories),
      ],
    );

    yield* sql.execute(
      "insert categorization batch transactions",
      `INSERT INTO categorization_batch_transactions (run_id, transaction_id, ordinal)
         SELECT $1, x.transaction_id::uuid, x.ordinal
           FROM jsonb_to_recordset($2::jsonb) AS x(transaction_id text, ordinal integer)`,
      [
        runId,
        JSON.stringify(
          batch.map((item, ordinal) => ({ transaction_id: item.transactionId, ordinal })),
        ),
      ],
    );
    yield* sql.execute(
      "insert categorization batch categories",
      `INSERT INTO categorization_batch_categories (run_id, category_id)
         SELECT $1, value::uuid FROM jsonb_array_elements_text($2::jsonb)`,
      [runId, JSON.stringify(categories.map((category) => category.id))],
    );
    yield* sql.execute(
      "enqueue categorization dispatch",
      `INSERT INTO capability_dispatches
           (run_id, status, attempt_count, last_error, created_at, dispatched_at)
         VALUES ($1, 'pending', 0, NULL, now(), NULL)`,
      [runId],
    );
    batchCount += 1;
  }

  return batchCount;
});

export const listPendingCategorizationDispatches = (
  sql: SqlExecutor,
  limit: number,
): Effect.Effect<readonly CategorizationDispatchPayload[], PersistenceError> =>
  Effect.gen(function* () {
    return yield* sql.rows(
      "list pending categorization dispatches",
      CategorizationDispatchSchema,
      `SELECT b.run_id AS "runId", b.config_version AS "configVersion",
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
  });

export const markCategorizationDispatched = (
  sql: SqlExecutor,
  runId: RunId,
): Effect.Effect<void, PersistenceError> =>
  sql.execute(
    "mark categorization dispatch complete",
    `UPDATE capability_dispatches
          SET status = 'dispatched', attempt_count = attempt_count + 1,
              last_error = NULL, dispatched_at = now()
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
          SET attempt_count = attempt_count + 1, last_error = $2
        WHERE run_id = $1 AND status = 'pending'`,
    [runId, detail.slice(0, 2_000)],
  );

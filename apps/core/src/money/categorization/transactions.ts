import {
  EffectiveSplit,
  Internal,
  NotFound,
  ValidationFailed,
  type LedgerEntry,
  type LedgerScope,
  type RuleInput,
  type SplitInput,
} from "@ironcage/contracts/schema";
import {
  Aud,
  BankAccountId,
  BankTransactionId,
  CalendarDate,
  uncategorizedCategoryId,
  type RequestId,
  type Sha256,
  type SplitProvenance,
} from "@ironcage/domain";
import { BigDecimal, Effect, Schema } from "effect";

import { mintUuidV7 } from "../../ids";
import { runIdempotentMutation } from "../../persistence/app-requests";
import { persistenceToBoundary } from "../../persistence/error";
import { Postgres } from "../../persistence/postgres";
import { requireActiveCategory } from "./categories";
import { insertRule } from "./rule-management";

const TransactionAmountRow = Schema.Struct({
  id: BankTransactionId,
  amount: Schema.BigDecimalFromString,
  revision: Schema.Int,
});

export interface CategorizeTransactionsInput {
  readonly requestId: RequestId;
  readonly payloadHash: Sha256;
  readonly changes: ReadonlyArray<{
    readonly transactionId: BankTransactionId;
    readonly splits: readonly SplitInput[];
  }>;
  readonly createRules: readonly RuleInput[];
}

export const categorizeTransactions = (input: CategorizeTransactionsInput) =>
  runIdempotentMutation(
    {
      requestId: input.requestId,
      operation: "categorizeTransactions",
      payloadHash: input.payloadHash,
      response: Schema.Struct({ updated: Schema.Int, rulesCreated: Schema.Int }),
    },
    (sql) =>
      Effect.gen(function* () {
        for (const change of input.changes) {
          if (change.splits.length === 0) {
            return yield* Effect.fail(
              new ValidationFailed({
                reason: "EmptySplits",
                detail: `${change.transactionId} needs at least one split`,
              }),
            );
          }

          const rows = yield* sql.rows(
            "read transaction for categorization",
            TransactionAmountRow,
            `SELECT t.id, t.amount::text AS amount,
                    COALESCE((SELECT max(revision) FROM transaction_splits s WHERE s.transaction_id = t.id), 0)::integer AS revision
               FROM bank_transactions t WHERE t.id = $1`,
            [change.transactionId],
          );
          const transaction = rows[0];
          if (transaction === undefined) {
            return yield* Effect.fail(
              new NotFound({ entity: "bank transaction", id: change.transactionId }),
            );
          }

          const total = BigDecimal.sumAll(change.splits.map((split) => split.amount));
          if (!BigDecimal.equals(total, transaction.amount)) {
            return yield* Effect.fail(
              new ValidationFailed({
                reason: "SplitSumMismatch",
                detail: `splits for ${change.transactionId} sum to ${BigDecimal.format(total)}, the transaction is ${BigDecimal.format(transaction.amount)}`,
              }),
            );
          }

          for (const split of change.splits) {
            if (split.categoryId !== uncategorizedCategoryId) {
              yield* requireActiveCategory(sql, split.categoryId);
            }
            yield* sql.execute(
              "insert manual split",
              `INSERT INTO transaction_splits (id, transaction_id, revision, category_id, amount, provenance, rule_id, created_at)
               VALUES ($1, $2, $3, $4, $5, 'manual', NULL, now())`,
              [
                mintUuidV7(),
                transaction.id,
                transaction.revision + 1,
                split.categoryId,
                BigDecimal.format(BigDecimal.normalize(split.amount)),
              ],
            );
          }

          // A manual split closes the corresponding applied model assignment.
          yield* sql.execute(
            "settle applied assignment",
            `UPDATE categorization_assignments
                SET status = CASE WHEN category_id = ANY($2::uuid[]) THEN 'kept' ELSE 'overridden' END
              WHERE transaction_id = $1 AND status = 'applied'`,
            [transaction.id, change.splits.map((split) => split.categoryId)],
          );
        }

        for (const rule of input.createRules) {
          yield* requireActiveCategory(sql, rule.categoryId);
          yield* insertRule(sql, rule, "correction");
        }

        return { updated: input.changes.length, rulesCreated: input.createRules.length };
      }),
  );

const LedgerRow = Schema.Struct({
  transactionId: BankTransactionId,
  accountId: BankAccountId,
  productLabel: Schema.String,
  postedDate: CalendarDate,
  amount: Aud,
  narrative: Schema.String,
  payee: Schema.String,
  splits: Schema.Array(EffectiveSplit),
  rationale: Schema.NullOr(Schema.String),
});

const provenanceRank: Record<SplitProvenance, number> = { manual: 3, rule: 2, ai: 1, system: 0 };

export const listTransactions = (
  scope: LedgerScope,
): Effect.Effect<readonly LedgerEntry[], NotFound | Internal, Postgres> =>
  Effect.gen(function* () {
    const postgres = yield* Postgres;
    const attention = scope.kind === "attention";
    const rows = yield* postgres.readTransaction((sql) =>
      sql.rows(
        "load ledger",
        LedgerRow,
        `WITH effective AS (
           SELECT s.transaction_id, s.category_id, s.amount, s.provenance
             FROM transaction_splits s
            WHERE s.revision = (SELECT max(revision) FROM transaction_splits latest
                                 WHERE latest.transaction_id = s.transaction_id)
         ),
         per_transaction AS (
           SELECT e.transaction_id,
                  jsonb_agg(jsonb_build_object(
                    'categoryId', e.category_id, 'categoryName', c.name,
                    'amount', e.amount::text, 'provenance', e.provenance
                  ) ORDER BY e.amount) AS splits,
                  bool_or(e.category_id = $1) AS uncategorized,
                  bool_or(e.provenance = 'ai') AS ai_filed
             FROM effective e JOIN categories c ON c.id = e.category_id
            GROUP BY e.transaction_id
         )
         SELECT t.id AS "transactionId", t.account_id AS "accountId", a.product_label AS "productLabel",
                t.posted_date AS "postedDate", t.amount::text AS amount,
                t.display_narrative AS narrative, t.derived_payee AS payee,
                p.splits, ca.rationale
           FROM bank_transactions t
           JOIN bank_accounts a ON a.id = t.account_id
           JOIN per_transaction p ON p.transaction_id = t.id
           LEFT JOIN categorization_assignments ca
             ON ca.transaction_id = t.id AND ca.status = 'applied'
          WHERE CASE WHEN $2::boolean THEN (p.uncategorized OR p.ai_filed)
                     ELSE to_char(t.posted_date, 'YYYY-MM') = $3 END
          ORDER BY p.uncategorized DESC, t.posted_date DESC, t.id DESC
          LIMIT 1000`,
        [uncategorizedCategoryId, attention, scope.kind === "month" ? scope.month : null],
      ),
    );
    return rows.map((row) => ({
      ...row,
      filedBy: row.splits.reduce<SplitProvenance>(
        (strongest, split) =>
          provenanceRank[split.provenance] > provenanceRank[strongest]
            ? split.provenance
            : strongest,
        "system",
      ),
    }));
  }).pipe(persistenceToBoundary);

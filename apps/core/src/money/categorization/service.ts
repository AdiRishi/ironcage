import {
  CategorySummary,
  Conflict,
  EffectiveSplit,
  Internal,
  NotFound,
  RuleSummary,
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
  CategorizationRuleId,
  CategoryId,
  CategoryKind,
  RulePredicate,
  uncategorizedCategoryId,
  type RequestId,
  type Sha256,
  type SplitProvenance,
} from "@ironcage/domain";
import { BigDecimal, Effect, Schema } from "effect";

import { mintId, mintRawUuidV7 } from "../../ids";
import { runIdempotentMutation } from "../../persistence/app-requests";
import { persistenceToBoundary } from "../../persistence/error";
import { decodeRows, Postgres, type SqlExecutor } from "../../persistence/postgres";

const CategoryRow = CategorySummary;

const categoryColumns = `id, name, kind, system, archived`;

export const listCategoryRows = (sql: SqlExecutor) =>
  Effect.gen(function* () {
    const rows = yield* sql.query(
      "list categories",
      `SELECT ${categoryColumns} FROM categories ORDER BY system DESC, name`,
    );
    return yield* decodeRows("decode categories", CategoryRow, rows);
  });

const getCategoryRow = (sql: SqlExecutor, id: CategoryId) =>
  Effect.gen(function* () {
    const rows = yield* sql.query(
      "read category",
      `SELECT ${categoryColumns} FROM categories WHERE id = $1`,
      [id],
    );
    const categories = yield* decodeRows("decode category", CategoryRow, rows);
    return categories[0] ?? null;
  });

export const listCategories = () =>
  Effect.gen(function* () {
    const postgres = yield* Postgres;
    return yield* postgres.readTransaction((sql) => listCategoryRows(sql));
  }).pipe(persistenceToBoundary);

export const createCategory = (input: {
  readonly requestId: RequestId;
  readonly payloadHash: Sha256;
  readonly name: string;
  readonly kind: CategoryKind;
}) =>
  runIdempotentMutation(
    {
      requestId: input.requestId,
      operation: "createCategory",
      payloadHash: input.payloadHash,
      response: CategorySummary,
    },
    (sql) =>
      Effect.gen(function* () {
        const existing = yield* listCategoryRows(sql);
        if (existing.some((category) => category.name === input.name)) {
          return yield* Effect.fail(
            new Conflict({ reason: "DuplicateCategory", detail: `"${input.name}" already exists` }),
          );
        }
        const id = yield* mintId(CategoryId);
        yield* sql.query(
          "insert category",
          `INSERT INTO categories (id, name, kind, system, archived, created_at)
           VALUES ($1, $2, $3, false, false, now())`,
          [id, input.name, input.kind],
        );
        return { id, name: input.name, kind: input.kind, system: false, archived: false };
      }),
  );

export const editCategory = (input: {
  readonly requestId: RequestId;
  readonly payloadHash: Sha256;
  readonly categoryId: CategoryId;
  readonly name: string | null;
  readonly archived: boolean | null;
}) =>
  runIdempotentMutation(
    {
      requestId: input.requestId,
      operation: "editCategory",
      payloadHash: input.payloadHash,
      response: CategorySummary,
    },
    (sql) =>
      Effect.gen(function* () {
        const category = yield* getCategoryRow(sql, input.categoryId);
        if (category === null) {
          return yield* Effect.fail(new NotFound({ entity: "category", id: input.categoryId }));
        }
        if (category.system) {
          return yield* Effect.fail(
            new ValidationFailed({
              reason: "SystemCategory",
              detail: "the system category cannot be renamed or archived",
            }),
          );
        }
        const name = input.name ?? category.name;
        const archived = input.archived ?? category.archived;
        yield* sql.query(
          "update category",
          "UPDATE categories SET name = $2, archived = $3 WHERE id = $1",
          [category.id, name, archived],
        );
        return { ...category, name, archived };
      }),
  );

const RuleRow = Schema.Struct({
  id: CategorizationRuleId,
  predicate: RulePredicate,
  categoryId: CategoryId,
  categoryName: Schema.String,
  createdBy: Schema.Literals(["operator", "correction"]),
  effectiveFrom: Schema.DateTimeUtcFromDate,
  effectiveTo: Schema.NullOr(Schema.DateTimeUtcFromDate),
});

const ruleColumns = `r.id, r.predicate, r.category_id AS "categoryId", c.name AS "categoryName",
  r.created_by AS "createdBy", r.effective_from AS "effectiveFrom", r.effective_to AS "effectiveTo"`;

const listRuleRows = (sql: SqlExecutor) =>
  Effect.gen(function* () {
    const rows = yield* sql.query(
      "list categorization rules",
      `SELECT ${ruleColumns} FROM categorization_rules r JOIN categories c ON c.id = r.category_id
        ORDER BY r.effective_from, r.id`,
    );
    return yield* decodeRows("decode categorization rules", RuleRow, rows);
  });

export const getCategorizationRules = () =>
  Effect.gen(function* () {
    const postgres = yield* Postgres;
    return yield* postgres.readTransaction((sql) => listRuleRows(sql));
  }).pipe(persistenceToBoundary);

const insertRule = (sql: SqlExecutor, rule: RuleInput, createdBy: "operator" | "correction") =>
  Effect.gen(function* () {
    const id = yield* mintId(CategorizationRuleId);
    yield* sql.query(
      "insert categorization rule",
      `INSERT INTO categorization_rules (id, predicate, category_id, created_by, effective_from, effective_to, created_at)
       VALUES ($1, $2::jsonb, $3, $4, now(), NULL, now())`,
      [id, JSON.stringify(rule.predicate), rule.categoryId, createdBy],
    );
    return id;
  });

const requireCategory = (sql: SqlExecutor, categoryId: CategoryId) =>
  Effect.gen(function* () {
    const category = yield* getCategoryRow(sql, categoryId);
    if (category === null) {
      return yield* Effect.fail(new NotFound({ entity: "category", id: categoryId }));
    }
    if (category.archived) {
      return yield* Effect.fail(
        new ValidationFailed({
          reason: "ArchivedCategory",
          detail: `"${category.name}" is archived`,
        }),
      );
    }
    return category;
  });

const readRule = (sql: SqlExecutor, ruleId: CategorizationRuleId) =>
  Effect.gen(function* () {
    const rows = yield* sql.query(
      "read categorization rule",
      `SELECT ${ruleColumns} FROM categorization_rules r JOIN categories c ON c.id = r.category_id
        WHERE r.id = $1`,
      [ruleId],
    );
    const rules = yield* decodeRows("decode categorization rule", RuleRow, rows);
    return rules[0] ?? null;
  });

export const editCategorizationRule = (input: {
  readonly requestId: RequestId;
  readonly payloadHash: Sha256;
  readonly action:
    | { readonly kind: "create"; readonly rule: RuleInput }
    | { readonly kind: "close"; readonly ruleId: CategorizationRuleId }
    | { readonly kind: "replace"; readonly ruleId: CategorizationRuleId; readonly rule: RuleInput };
}) =>
  runIdempotentMutation(
    {
      requestId: input.requestId,
      operation: "editCategorizationRule",
      payloadHash: input.payloadHash,
      response: RuleSummary,
    },
    (sql) =>
      Effect.gen(function* () {
        const closeRule = (ruleId: CategorizationRuleId) =>
          Effect.gen(function* () {
            const rule = yield* readRule(sql, ruleId);
            if (rule === null) {
              return yield* Effect.fail(
                new NotFound({ entity: "categorization rule", id: ruleId }),
              );
            }
            yield* sql.query(
              "close categorization rule",
              "UPDATE categorization_rules SET effective_to = now() WHERE id = $1 AND effective_to IS NULL",
              [ruleId],
            );
            return rule;
          });

        switch (input.action.kind) {
          case "create": {
            yield* requireCategory(sql, input.action.rule.categoryId);
            const id = yield* insertRule(sql, input.action.rule, "operator");
            return (yield* readRule(sql, id))!;
          }
          case "close": {
            yield* closeRule(input.action.ruleId);
            return (yield* readRule(sql, input.action.ruleId))!;
          }
          case "replace": {
            yield* requireCategory(sql, input.action.rule.categoryId);
            yield* closeRule(input.action.ruleId);
            const id = yield* insertRule(sql, input.action.rule, "operator");
            return (yield* readRule(sql, id))!;
          }
        }
      }),
  );

const TransactionAmountRow = Schema.Struct({
  id: BankTransactionId,
  amount: Schema.BigDecimalFromString,
  revision: Schema.Int,
});

export const categorizeTransactions = (input: {
  readonly requestId: RequestId;
  readonly payloadHash: Sha256;
  readonly changes: ReadonlyArray<{
    readonly transactionId: BankTransactionId;
    readonly splits: readonly SplitInput[];
  }>;
  readonly createRules: readonly RuleInput[];
}) =>
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

          const rows = yield* sql.query(
            "read transaction for categorization",
            `SELECT t.id, t.amount::text AS amount,
                    COALESCE((SELECT max(revision) FROM transaction_splits s WHERE s.transaction_id = t.id), 0)::integer AS revision
               FROM bank_transactions t WHERE t.id = $1`,
            [change.transactionId],
          );
          const decoded = yield* decodeRows("decode transaction", TransactionAmountRow, rows);
          const transaction = decoded[0];
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
              yield* requireCategory(sql, split.categoryId);
            }
            yield* sql.query(
              "insert manual split",
              `INSERT INTO transaction_splits (id, transaction_id, revision, category_id, amount, provenance, rule_id, created_at)
               VALUES ($1, $2, $3, $4, $5, 'manual', NULL, now())`,
              [
                mintRawUuidV7(),
                transaction.id,
                transaction.revision + 1,
                split.categoryId,
                BigDecimal.format(BigDecimal.normalize(split.amount)),
              ],
            );
          }

          // The operator's choice settles the model's applied assignment:
          // kept when they chose the same category, overridden otherwise.
          yield* sql.query(
            "settle applied assignment",
            `UPDATE categorization_assignments
                SET status = CASE WHEN category_id = ANY($2::uuid[]) THEN 'kept' ELSE 'overridden' END
              WHERE transaction_id = $1 AND status = 'applied'`,
            [transaction.id, change.splits.map((split) => split.categoryId)],
          );
        }

        for (const rule of input.createRules) {
          yield* requireCategory(sql, rule.categoryId);
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

/**
 * The ledger read: every transaction in scope with its effective splits, who
 * filed them, and the model's rationale where it did. The attention scope
 * puts uncategorized rows first so a long AI-filed history can never crowd
 * out the few that need a hand.
 */
export const listTransactions = (
  scope: LedgerScope,
): Effect.Effect<readonly LedgerEntry[], NotFound | Internal, Postgres> =>
  Effect.gen(function* () {
    const postgres = yield* Postgres;
    const attention = scope.kind === "attention";
    const rows = yield* postgres.readTransaction((sql) =>
      sql.query(
        "load ledger",
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
    const decoded = yield* decodeRows("decode ledger", LedgerRow, rows);

    return decoded.map((row) => ({
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

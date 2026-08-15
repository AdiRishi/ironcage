import { NotFound, RuleSummary, type RuleInput } from "@ironcage/contracts/schema";
import {
  CategorizationRuleId,
  CategoryId,
  RulePredicate,
  type RequestId,
  type Sha256,
} from "@ironcage/domain";
import { Effect, Schema } from "effect";

import { mintId } from "../../ids";
import { runIdempotentMutation } from "../../persistence/app-requests";
import { persistenceToBoundary } from "../../persistence/error";
import { Postgres, type SqlExecutor } from "../../persistence/postgres";
import { requireActiveCategory } from "./categories";

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
  sql.rows(
    "list categorization rules",
    RuleRow,
    `SELECT ${ruleColumns} FROM categorization_rules r JOIN categories c ON c.id = r.category_id
      ORDER BY r.effective_from, r.id`,
  );

const readRule = (sql: SqlExecutor, ruleId: CategorizationRuleId) =>
  Effect.map(
    sql.rows(
      "read categorization rule",
      RuleRow,
      `SELECT ${ruleColumns} FROM categorization_rules r JOIN categories c ON c.id = r.category_id
        WHERE r.id = $1`,
      [ruleId],
    ),
    (rows) => rows[0] ?? null,
  );

export const insertRule = Effect.fn("insertCategorizationRule")(function* (
  sql: SqlExecutor,
  rule: RuleInput,
  createdBy: "operator" | "correction",
) {
  const id = yield* mintId(CategorizationRuleId);
  yield* sql.execute(
    "insert categorization rule",
    `INSERT INTO categorization_rules (id, predicate, category_id, created_by, effective_from, effective_to, created_at)
     VALUES ($1, $2::jsonb, $3, $4, now(), NULL, now())`,
    [id, JSON.stringify(rule.predicate), rule.categoryId, createdBy],
  );
  return id;
});

export const getCategorizationRules = Effect.fn("getCategorizationRules")(function* () {
  const postgres = yield* Postgres;
  return yield* postgres.readTransaction(listRuleRows);
}, persistenceToBoundary);

export interface EditCategorizationRuleInput {
  readonly requestId: RequestId;
  readonly payloadHash: Sha256;
  readonly action:
    | { readonly kind: "create"; readonly rule: RuleInput }
    | { readonly kind: "close"; readonly ruleId: CategorizationRuleId }
    | { readonly kind: "replace"; readonly ruleId: CategorizationRuleId; readonly rule: RuleInput };
}

export const editCategorizationRule = (input: EditCategorizationRuleInput) =>
  runIdempotentMutation(
    {
      requestId: input.requestId,
      operation: "editCategorizationRule",
      payloadHash: input.payloadHash,
      response: RuleSummary,
    },
    (sql) =>
      Effect.gen(function* () {
        const closeRule = Effect.fn("closeCategorizationRule")(function* (
          ruleId: CategorizationRuleId,
        ) {
          const rule = yield* readRule(sql, ruleId);
          if (rule === null) {
            return yield* Effect.fail(new NotFound({ entity: "categorization rule", id: ruleId }));
          }
          yield* sql.execute(
            "close categorization rule",
            "UPDATE categorization_rules SET effective_to = now() WHERE id = $1 AND effective_to IS NULL",
            [ruleId],
          );
          return rule;
        });

        switch (input.action.kind) {
          case "create": {
            yield* requireActiveCategory(sql, input.action.rule.categoryId);
            const id = yield* insertRule(sql, input.action.rule, "operator");
            return (yield* readRule(sql, id))!;
          }
          case "close": {
            yield* closeRule(input.action.ruleId);
            return (yield* readRule(sql, input.action.ruleId))!;
          }
          case "replace": {
            yield* requireActiveCategory(sql, input.action.rule.categoryId);
            yield* closeRule(input.action.ruleId);
            const id = yield* insertRule(sql, input.action.rule, "operator");
            return (yield* readRule(sql, id))!;
          }
        }
      }),
  );

import { CategorizationRuleId, CategoryId, RulePredicate } from "@ironcage/domain";
import { Effect, Schema } from "effect";

import type { PersistenceError, SqlExecutor } from "../../persistence";
import type { EffectiveRule } from "./rules";

const RuleRow = Schema.Struct({
  id: CategorizationRuleId,
  predicate: RulePredicate,
  categoryId: CategoryId,
  categoryName: Schema.String,
});

export const loadEffectiveRules = (
  sql: SqlExecutor,
): Effect.Effect<readonly EffectiveRule[], PersistenceError> =>
  Effect.gen(function* () {
    return yield* sql.rows(
      "load effective rules",
      RuleRow,
      `SELECT r.id, r.predicate, r.category_id AS "categoryId", c.name AS "categoryName"
         FROM categorization_rules r
         JOIN categories c ON c.id = r.category_id
        WHERE r.effective_from <= now() AND (r.effective_to IS NULL OR r.effective_to > now())
        ORDER BY r.effective_from, r.id`,
    );
  });

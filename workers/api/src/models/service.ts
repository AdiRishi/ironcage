import { PgClient } from "@effect/sql-pg";
import { ModelUsage } from "@repo/contracts/finance";
import { Context, Effect, Layer, Schema } from "effect";

import { instant, nullableMoney } from "../database/columns.ts";
import { toFinanceError } from "../database/failures.ts";

const make = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;
  const get = sql
    .withTransaction(
      Effect.gen(function* () {
        yield* sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
        const totals =
          yield* sql`SELECT count(*)::integer AS calls, COALESCE(sum(input_tokens), 0)::text AS "inputTokens", COALESCE(sum(output_tokens), 0)::text AS "outputTokens", count(*) FILTER (WHERE input_tokens IS NULL OR output_tokens IS NULL OR cost_minor IS NULL)::integer AS "unknownUsage" FROM model_usage`;
        const costs =
          yield* sql`SELECT cost_currency AS currency, sum(cost_minor)::text AS minor FROM model_usage WHERE cost_minor IS NOT NULL GROUP BY cost_currency ORDER BY cost_currency`;
        const recent =
          yield* sql`SELECT id, task, model, ${instant(sql, sql("occurred_at"))} AS "occurredAt", input_tokens::text AS "inputTokens", output_tokens::text AS "outputTokens", ${nullableMoney(sql, "cost_currency", "cost_minor")} AS cost, status FROM model_usage ORDER BY occurred_at DESC, id DESC LIMIT 20`;
        return yield* Schema.decodeUnknownEffect(ModelUsage)({
          ...totals[0],
          costs,
          recent,
        });
      }),
    )
    .pipe(toFinanceError, Effect.withSpan("ModelUsage.get"));
  return { get };
});
export class Models extends Context.Service<Models, Effect.Success<typeof make>>()(
  "@repo/api/models/Models",
) {
  static readonly layer = Layer.effect(Models, make);
}

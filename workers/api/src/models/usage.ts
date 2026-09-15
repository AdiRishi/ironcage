import { PgClient } from "@effect/sql-pg";
import { ModelUsage } from "@repo/contracts/finance";
import { Context, Effect, Layer, Schema } from "effect";

import { databaseUnavailable } from "../database/commands.ts";

const make = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;
  const get = sql
    .withTransaction(
      Effect.gen(function* () {
        yield* sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
        const settings =
          yield* sql`SELECT ai_enabled AS enabled, CASE WHEN ai_warning_minor IS NULL THEN NULL ELSE jsonb_build_object('currency', reporting_currency, 'minor', ai_warning_minor::text) END AS warning FROM settings WHERE id = 1`;
        const totals =
          yield* sql`SELECT count(*)::integer AS calls, COALESCE(sum(input_tokens), 0)::text AS "inputTokens", COALESCE(sum(output_tokens), 0)::text AS "outputTokens", count(*) FILTER (WHERE input_tokens IS NULL OR output_tokens IS NULL OR cost_minor IS NULL)::integer AS "unknownUsage" FROM model_usage`;
        const costs =
          yield* sql`SELECT cost_currency AS currency, sum(cost_minor)::text AS minor FROM model_usage WHERE cost_minor IS NOT NULL GROUP BY cost_currency ORDER BY cost_currency`;
        const recent =
          yield* sql`SELECT id, task, model, to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "occurredAt", input_tokens::text AS "inputTokens", output_tokens::text AS "outputTokens", CASE WHEN cost_minor IS NULL THEN NULL ELSE jsonb_build_object('currency', cost_currency, 'minor', cost_minor::text) END AS cost, status FROM model_usage ORDER BY occurred_at DESC, id DESC LIMIT 20`;
        return yield* Schema.decodeUnknownEffect(ModelUsage)({
          ...settings[0],
          ...totals[0],
          provider: null,
          costs,
          recent,
        });
      }),
    )
    .pipe(Effect.mapError(databaseUnavailable), Effect.withSpan("ModelUsage.get"));
  return { get };
});
export class Models extends Context.Service<Models, Effect.Success<typeof make>>()(
  "@repo/api/Models",
) {
  static readonly layer = Layer.effect(Models, make);
}

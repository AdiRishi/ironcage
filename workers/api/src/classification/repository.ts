import { PgClient } from "@effect/sql-pg";
import {
  ClassificationRun,
  ClassificationSettings,
  FinanceError,
  type ClassificationRunId,
} from "@repo/contracts/finance";
import { Effect, Schema } from "effect";

import { instant } from "../database/columns.ts";
import { ClassificationConfig } from "./config.ts";
export const classificationSettings = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;
  const config = yield* ClassificationConfig;
  const [row] =
    yield* sql`SELECT enabled,CASE WHEN warning_minor IS NULL THEN NULL ELSE jsonb_build_object('currency','USD','minor',warning_minor::text) END AS warning,version FROM classification_settings WHERE id=1`;
  return yield* Schema.decodeUnknownEffect(ClassificationSettings)({
    ...row,
    provider: config.provider
      ? yield* Schema.encodeEffect(ClassificationSettings.fields.provider)(config.provider)
      : null,
  });
});
export const ensureClassificationEnabled = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;
  const settings = yield* classificationSettings;
  if (!settings.enabled || !settings.provider)
    return yield* new FinanceError({
      kind: "unavailable",
      message:
        "Category suggestions are disabled or no provider is configured. Manual categorization is available.",
    });
  const [row] =
    yield* sql`SELECT COALESCE(sum(cost_minor),0)::text AS total FROM model_usage WHERE task='classification' AND cost_currency='USD'`.pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(
          Schema.Tuple([Schema.Struct({ total: Schema.BigIntFromString })]),
        ),
      ),
    );
  if (settings.warning && row.total >= settings.warning.minor)
    return yield* new FinanceError({
      kind: "unavailable",
      message:
        "The observed model usage reached the warning threshold. Review usage in Settings before requesting more suggestions.",
    });
  return settings.provider;
});
export const classificationRuns = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;
  return yield* sql`SELECT r.id,r.status,r.model,${instant(sql, sql("r.created_at"))} AS "createdAt",r.requested,(SELECT count(*)::integer FROM classification_items i WHERE i.run_id=r.id AND i.status<>'pending') AS processed,r.failure FROM classification_runs r ORDER BY r.created_at DESC,r.id DESC LIMIT 20`.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(ClassificationRun))),
  );
});
export const readClassificationRun = Effect.fn(function* (runId: typeof ClassificationRunId.Type) {
  const sql = yield* PgClient.PgClient;
  const [run] =
    yield* sql`SELECT r.id,r.status,r.model,${instant(sql, sql("r.created_at"))} AS "createdAt",r.requested,(SELECT count(*)::integer FROM classification_items i WHERE i.run_id=r.id AND i.status<>'pending') AS processed,r.failure FROM classification_runs r WHERE id=${runId}`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(ClassificationRun))),
    );
  if (!run)
    return yield* new FinanceError({ kind: "notFound", message: "Classification run not found." });
  return run;
});

import { PgClient } from "@effect/sql-pg";
import {
  Confidence,
  ModelAllowance,
  ModelSettings,
  ModelUsage,
  ModelUsageEntry,
  ModelTask,
  type RecordModelUsage,
  Version,
} from "@repo/contracts/finance";
import { Effect, Schema } from "effect";
import type { Statement } from "effect/unstable/sql";

import { instant, nullableMoney } from "../database/columns.ts";
import { ModelProviders } from "../platform/services.ts";

// An evaluation uses identification's switch and model, and a briefing the analyst's.
const taskFeatures = {
  enrichment: "enrichment",
  evaluation: "enrichment",
  analyst: "analyst",
  briefing: "analyst",
} as const satisfies Record<ModelTask, keyof ModelProviders["Service"]>;

const switchedOff = {
  enrichment: "Counterparty identification is switched off. Turn it on in Settings.",
  analyst: "The analyst is off. Turn it on in Settings.",
} satisfies Record<keyof ModelProviders["Service"], string>;

const SettingsRow = Schema.Struct({
  enrichmentEnabled: Schema.Boolean,
  autoApplyConfidence: Confidence,
  analystEnabled: Schema.Boolean,
  warning: ModelSettings.fields.warning,
  version: Version,
});

export const readModelSettings = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;
  const providers = yield* ModelProviders;
  const [row] =
    yield* sql`SELECT enrichment_enabled AS "enrichmentEnabled", auto_apply_confidence::float8 AS "autoApplyConfidence",
      analyst_enabled AS "analystEnabled", version,
      CASE WHEN warning_minor IS NULL THEN NULL ELSE jsonb_build_object('currency', 'USD', 'minor', warning_minor::text) END AS warning
      FROM model_settings WHERE id = 1`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Tuple([SettingsRow]))),
    );
  return {
    enrichment: {
      enabled: row.enrichmentEnabled,
      autoApplyConfidence: row.autoApplyConfidence,
      provider: providers.enrichment,
    },
    analyst: { enabled: row.analystEnabled, provider: providers.analyst },
    warning: row.warning,
    version: row.version,
  } satisfies ModelSettings;
});

// A task may call its model while its switch is on and the recorded cost of every task
// together is under the warning. Usage reported late, or by calls made at once, can pass
// the warning.
export const readModelAllowance = Effect.fn("readModelAllowance")(function* (task: ModelTask) {
  const sql = yield* PgClient.PgClient;
  const settings = yield* readModelSettings;
  const feature = taskFeatures[task];
  if (!settings[feature].enabled)
    return { allowed: false, message: switchedOff[feature] } satisfies typeof ModelAllowance.Type;
  const [usage] =
    yield* sql`SELECT COALESCE(sum(cost_minor), 0)::text AS total FROM model_usage WHERE cost_currency = 'USD'`.pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(
          Schema.Tuple([Schema.Struct({ total: Schema.BigIntFromString })]),
        ),
      ),
    );
  if (settings.warning && usage.total >= settings.warning.minor)
    return {
      allowed: false,
      message: "Model usage reached the warning in Settings. Raise it to continue.",
    } satisfies typeof ModelAllowance.Type;
  return {
    allowed: true,
    provider: settings[feature].provider,
  } satisfies typeof ModelAllowance.Type;
});

const entryColumns = (sql: PgClient.PgClient) =>
  sql`id, task, model, ${instant(sql, sql("occurred_at"))} AS "occurredAt", input_tokens::text AS "inputTokens",
    output_tokens::text AS "outputTokens", ${nullableMoney(sql, "cost_currency", "cost_minor")} AS cost, status`;

// One row per call, keyed by the command that recorded it.
export const insertModelUsage = Effect.fn("insertModelUsage")(function* (
  usage: typeof RecordModelUsage.Type,
) {
  const sql = yield* PgClient.PgClient;
  const [entry] =
    yield* sql`INSERT INTO model_usage (id, task, model, input_tokens, output_tokens, cost_minor, cost_currency, status)
      VALUES (${usage.commandId}, ${usage.task}, ${usage.model}, ${usage.inputTokens}, ${usage.outputTokens},
        ${usage.cost?.minor ?? null}, ${usage.cost?.currency ?? null}, ${usage.status})
      RETURNING ${entryColumns(sql)}`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Tuple([ModelUsageEntry]))),
    );
  return entry;
});

// Calls, tokens, and cost in each currency over `model_usage u`, with costs summed from
// the rows of `model_usage m` that `costs` selects. `sum` skips unreported tokens, and is
// null when no call reported any.
const totals = (sql: PgClient.PgClient, costs: Statement.Fragment) =>
  sql`count(*)::integer AS calls, sum(u.input_tokens)::text AS "inputTokens",
    sum(u.output_tokens)::text AS "outputTokens",
    count(*) FILTER (WHERE u.input_tokens IS NULL OR u.output_tokens IS NULL OR u.cost_minor IS NULL)::integer AS "unknownUsage",
    COALESCE((SELECT jsonb_agg(jsonb_build_object('currency', c.currency, 'minor', c.minor::text) ORDER BY c.currency)
      FROM (SELECT m.cost_currency AS currency, sum(m.cost_minor) AS minor FROM model_usage m
        WHERE m.cost_minor IS NOT NULL AND ${costs} GROUP BY m.cost_currency) c), '[]'::jsonb) AS costs`;

export const readModelUsage = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;
  const [all] = yield* sql`SELECT ${totals(sql, sql`true`)} FROM model_usage u`;
  const tasks =
    yield* sql`SELECT u.task, ${totals(sql, sql`m.task = u.task`)} FROM model_usage u GROUP BY u.task
    ORDER BY array_position(${ModelTask.literals}::text[], u.task) NULLS LAST, u.task`;
  const recent =
    yield* sql`SELECT ${entryColumns(sql)} FROM model_usage ORDER BY occurred_at DESC, id DESC LIMIT 20`;
  return yield* Schema.decodeUnknownEffect(ModelUsage)({ ...all, tasks, recent });
});

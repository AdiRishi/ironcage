import { PgClient } from "@effect/sql-pg";
import {
  CategoryId,
  CategoryProposalOutcome,
  CategoryProposals,
  CommandId,
  CompleteEnrichmentBatch,
  Confidence,
  CounterpartyKind,
  EnrichmentAlias,
  EnrichmentBatch,
  EnrichmentCategory,
  EnrichmentExample,
  EnrichmentInput,
  EnrichmentRun,
  EnrichmentRunId,
  EnrichmentRuns,
  EnrichmentSettings,
  EvaluationAnswer,
  EventId,
  FinanceError,
  FailEnrichment,
  type EnrichmentResult,
  RequestEnrichment,
  RequestEvaluation,
  ResolveCategoryProposal,
  UpdateEnrichmentSettings,
  CounterpartyId,
} from "@repo/contracts/finance";
import { scoreEvaluation, takesDefaultRole } from "@repo/finance";
import { Context, Crypto, Effect, Layer, Schema, Struct } from "effect";
import type { Statement } from "effect/unstable/sql";

import { instant } from "../database/columns.ts";
import { Commands } from "../database/commands.ts";
import { toFinanceError } from "../database/failures.ts";
import {
  EnrichmentConfig,
  EnrichmentJobs,
  ensureWorkflowStatus,
  workflowEnded,
} from "../platform/services.ts";
import {
  applyImages,
  noImages,
  readCounterpartyRecords,
  recordChange,
} from "./counterparty-changes.ts";
import { descriptorSamples } from "./descriptors.ts";
import { reinterpret } from "./engine.ts";

const batchSize = 25;
const exampleCount = 20;

const runColumns = (sql: PgClient.PgClient) =>
  sql`r.id, r.purpose, r.status, r.model, ${instant(sql, sql("r.created_at"))} AS "createdAt", r.requested,
    (SELECT count(*)::int FROM enrichment_items i WHERE i.run_id = r.id AND i.status = 'resolved') AS resolved,
    (SELECT count(*)::int FROM enrichment_items i WHERE i.run_id = r.id AND i.status = 'failed') AS failed, r.failure`;

const RunRow = Schema.Struct(Struct.omit(EnrichmentRun.fields, ["evaluation"]));
const Prediction = Schema.Struct({ ...EvaluationAnswer.fields, confidence: Confidence });

// Runs matching `where`, newest first. An evaluation run carries its score so far.
const readRuns = Effect.fn("readEnrichmentRuns")(function* (where: Statement.Fragment) {
  const sql = yield* PgClient.PgClient;
  const rows =
    yield* sql`SELECT ${runColumns(sql)} FROM enrichment_runs r WHERE ${where} ORDER BY r.created_at DESC, r.id DESC LIMIT 20`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(RunRow))),
    );
  return yield* Effect.forEach(rows, (row) =>
    Effect.gen(function* () {
      if (row.purpose !== "evaluate") return { ...row, evaluation: null };
      const [settings] =
        yield* sql`SELECT auto_apply_confidence::float8 AS threshold FROM enrichment_settings WHERE id = 1`.pipe(
          Effect.flatMap(
            Schema.decodeUnknownEffect(Schema.Tuple([Schema.Struct({ threshold: Confidence })])),
          ),
        );
      const answers =
        yield* sql`SELECT expected, predicted FROM enrichment_evaluations WHERE run_id = ${row.id}`.pipe(
          Effect.flatMap(
            Schema.decodeUnknownEffect(
              Schema.Array(
                Schema.Struct({ expected: EvaluationAnswer, predicted: Schema.NullOr(Prediction) }),
              ),
            ),
          ),
        );
      return {
        ...row,
        evaluation: scoreEvaluation({ rows: answers, threshold: settings.threshold }),
      };
    }),
  );
});

const readRun = Effect.fn("readEnrichmentRun")(function* (runId: typeof EnrichmentRunId.Type) {
  const sql = yield* PgClient.PgClient;
  const [run] = yield* readRuns(sql`r.id = ${runId}`);
  if (!run)
    return yield* new FinanceError({ kind: "notFound", message: "Enrichment run not found." });
  return run;
});

const readSettings = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;
  const config = yield* EnrichmentConfig;
  const [row] =
    yield* sql`SELECT enabled, CASE WHEN warning_minor IS NULL THEN NULL ELSE jsonb_build_object('currency', 'USD', 'minor', warning_minor::text) END AS warning,
      auto_apply_confidence::float8 AS "autoApplyConfidence", version FROM enrichment_settings WHERE id = 1`;
  return yield* Schema.decodeUnknownEffect(EnrichmentSettings)({
    ...row,
    provider: yield* Schema.encodeEffect(EnrichmentSettings.fields.provider)(config.provider),
  });
});

// Enrichment only runs while you have it switched on and recorded usage is under
// the warning. Late reports and concurrent calls can overshoot the warning.
const ensureEnabled = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;
  const settings = yield* readSettings;
  if (!settings.enabled)
    return yield* new FinanceError({
      kind: "unavailable",
      message: "Counterparty identification is switched off. Turn it on in Settings.",
    });
  const [usage] =
    yield* sql`SELECT COALESCE(sum(cost_minor), 0)::text AS total FROM model_usage WHERE cost_currency = 'USD'`.pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(
          Schema.Tuple([Schema.Struct({ total: Schema.BigIntFromString })]),
        ),
      ),
    );
  if (settings.warning && usage.total >= settings.warning.minor)
    return yield* new FinanceError({
      kind: "unavailable",
      message: "Model usage reached the warning threshold. Raise it in Settings to continue.",
    });
  return settings;
});

// The taxonomy, existing counterparties, and your recent answers as examples. An
// evaluation leaves out the counterparties whose aliases it asks about, so the model
// cannot copy your answer.
const readBatchContext = Effect.fn("readBatchContext")(function* (
  hidden: readonly (typeof CounterpartyId.Type)[],
) {
  const sql = yield* PgClient.PgClient;
  const visible = sql`NOT (${sql.in("c.id", hidden)})`;
  const categories =
    yield* sql`SELECT COALESCE(c.slug, c.id::text) AS key, c.name, COALESCE(p.slug, p.id::text) AS "parentKey", c.tree
      FROM categories c LEFT JOIN categories p ON p.id = c.parent_id WHERE NOT c.archived ORDER BY c.tree DESC, p.position NULLS FIRST, c.position, c.name`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(EnrichmentCategory))),
    );
  const counterparties =
    yield* sql`SELECT c.id, c.name, c.kind FROM counterparties c WHERE ${visible} ORDER BY c.name, c.id`.pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(
          Schema.Array(
            Schema.Struct({ id: CounterpartyId, name: Schema.String, kind: CounterpartyKind }),
          ),
        ),
      ),
    );
  const examples =
    yield* sql`SELECT ARRAY(SELECT DISTINCT d.counterparty_text FROM counterparty_aliases a JOIN posting_descriptors d ON d.alias_key = a.alias_key
        WHERE a.counterparty_id = c.id AND d.counterparty_text IS NOT NULL LIMIT 3) AS samples,
        c.name, c.kind, COALESCE(k.slug, k.id::text) AS "categoryKey", c.default_role AS "defaultRole"
      FROM counterparties c LEFT JOIN categories k ON k.id = c.default_category_id
      WHERE c.source = 'user' AND ${visible} AND EXISTS (SELECT 1 FROM counterparty_aliases a JOIN posting_descriptors d ON d.alias_key = a.alias_key WHERE a.counterparty_id = c.id AND d.counterparty_text IS NOT NULL)
      ORDER BY c.updated_at DESC, c.id LIMIT ${exampleCount}`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(EnrichmentExample))),
    );
  return { categories, counterparties, examples };
});

const resolveCategory = Effect.fn("resolveCategory")(function* (key: string | null) {
  if (!key) return null;
  const sql = yield* PgClient.PgClient;
  const [row] =
    yield* sql`SELECT id FROM categories WHERE NOT archived AND (slug = ${key} OR id::text = ${key})`.pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ id: Schema.String }))),
      ),
    );
  return row?.id ?? null;
});

// Links an alias to the counterparty the model named, creating it when needed. A
// counterparty with the same name is reused, so aliases of one business resolved in
// different batches still meet. Below the threshold, an alias that names an existing
// counterparty is only proposed, so it becomes a question instead of taking that
// counterparty's defaults.
const applyResult = Effect.fn("applyEnrichmentResult")(function* ({
  result,
  model,
  threshold,
}: {
  result: EnrichmentResult;
  model: string;
  threshold: number;
}) {
  const sql = yield* PgClient.PgClient;
  const crypto = yield* Crypto.Crypto;
  const Row = Schema.Array(Schema.Struct({ id: CounterpartyId }));
  const named = result.existingCounterpartyId
    ? yield* sql`SELECT id FROM counterparties WHERE id::text = ${result.existingCounterpartyId}`.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Row)),
      )
    : [];
  const [existing] =
    named.length > 0
      ? named
      : yield* sql`SELECT id FROM counterparties WHERE lower(name) = lower(${result.name}) ORDER BY source DESC, created_at LIMIT 1`.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Row)),
        );
  let counterpartyId = existing?.id;
  if (!counterpartyId) {
    counterpartyId = CounterpartyId.make(yield* crypto.randomUUIDv4);
    const applied = result.kind !== "person" && result.confidence >= threshold;
    const defaultRole = takesDefaultRole(result.kind) ? result.defaultRole : null;
    yield* sql`INSERT INTO counterparties (id, name, kind, brand, default_category_id, default_role, source, status, model, confidence, reason)
      VALUES (${counterpartyId}, ${result.name}, ${result.kind}, ${result.brand}, ${yield* resolveCategory(result.categoryKey)}, ${defaultRole},
        'model', ${applied ? "applied" : "proposed"}, ${model}, ${result.confidence}, ${result.reason})`;
  }
  const status = existing && result.confidence < threshold ? "proposed" : "applied";
  yield* sql`INSERT INTO counterparty_aliases (alias_key, counterparty_id, source, status, confidence, reason)
    VALUES (${result.aliasKey}, ${counterpartyId}, 'model', ${status}, ${result.confidence}, ${result.reason}) ON CONFLICT (alias_key) DO NOTHING`;
  if (result.proposedSubcategory) {
    const parentId = yield* resolveCategory(result.proposedSubcategory.parentKey);
    if (parentId)
      yield* sql`INSERT INTO category_proposals (id, parent_id, name, reason, alias_keys) VALUES (${yield* crypto.randomUUIDv4}, ${parentId}, ${result.proposedSubcategory.name}, ${result.reason}, ARRAY[${result.aliasKey}]::text[])
        ON CONFLICT (parent_id, name) DO UPDATE SET alias_keys = array(SELECT DISTINCT unnest(category_proposals.alias_keys || EXCLUDED.alias_keys))`;
  }
});

export class Enrichment extends Context.Service<
  Enrichment,
  {
    readonly settings: Effect.Effect<typeof EnrichmentSettings.Type, FinanceError>;
    readonly configure: (
      input: typeof UpdateEnrichmentSettings.Type,
    ) => Effect.Effect<boolean, FinanceError>;
    readonly request: (
      input: typeof RequestEnrichment.Type,
    ) => Effect.Effect<typeof EnrichmentRun.Type, FinanceError>;
    readonly runs: Effect.Effect<typeof EnrichmentRuns.Type, FinanceError>;
    readonly evaluate: (
      input: typeof RequestEvaluation.Type,
    ) => Effect.Effect<typeof EnrichmentRun.Type, FinanceError>;
    readonly batch: (
      input: typeof EnrichmentInput.Type,
    ) => Effect.Effect<typeof EnrichmentBatch.Type, FinanceError>;
    readonly complete: (
      input: typeof CompleteEnrichmentBatch.Type,
    ) => Effect.Effect<boolean, FinanceError>;
    readonly fail: (input: typeof FailEnrichment.Type) => Effect.Effect<boolean, FinanceError>;
    readonly proposals: Effect.Effect<typeof CategoryProposals.Type, FinanceError>;
    readonly resolveProposal: (
      input: typeof ResolveCategoryProposal.Type,
    ) => Effect.Effect<typeof CategoryProposalOutcome.Type, FinanceError>;
  }
>()("@repo/api/interpretation/Enrichment") {
  static readonly layer = Layer.effect(
    Enrichment,
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      const crypto = yield* Crypto.Crypto;
      const commands = yield* Commands;
      const jobs = yield* EnrichmentJobs;
      const config = yield* EnrichmentConfig;
      const provide = <A, E>(
        effect: Effect.Effect<A, E, PgClient.PgClient | Crypto.Crypto | EnrichmentConfig>,
      ) =>
        effect.pipe(
          Effect.provideService(PgClient.PgClient, sql),
          Effect.provideService(Crypto.Crypto, crypto),
          Effect.provideService(EnrichmentConfig, config),
        );

      const settings = readSettings.pipe(provide, toFinanceError);

      // A run whose Workflow ended without finishing its aliases failed; a start that
      // was lost after the run committed is recovered, since creating is idempotent.
      const refresh = Effect.fn("Enrichment.refresh")(function* (run: typeof EnrichmentRun.Type) {
        if (run.status !== "pending" && run.status !== "running") return run;
        const state = yield* ensureWorkflowStatus(jobs, { runId: run.id }, run.id);
        if (!state || !workflowEnded(state)) return run;
        yield* sql`UPDATE enrichment_runs SET status = 'failed', failure = ${state.failure ?? "Identification stopped before it finished. Run it again to continue."}
          WHERE id = ${run.id} AND status IN ('pending', 'running')`;
        return yield* readRun(run.id).pipe(Effect.provideService(PgClient.PgClient, sql));
      });
      const activeRuns = readRuns(sql`r.status IN ('pending', 'running')`).pipe(
        Effect.provideService(PgClient.PgClient, sql),
        Effect.flatMap((rows) => Effect.forEach(rows, refresh)),
      );

      const configure = Effect.fn("Enrichment.configure")(function* (
        input: typeof UpdateEnrichmentSettings.Type,
      ) {
        if (input.warning && (input.warning.currency !== "USD" || input.warning.minor <= 0n))
          return yield* new FinanceError({
            kind: "invalid",
            message: "Use a positive USD usage warning.",
          });
        return yield* commands.run({
          commandId: input.commandId,
          input: {
            operation: "updateEnrichmentSettings",
            input: yield* Schema.encodeEffect(Schema.toCodecJson(UpdateEnrichmentSettings))(input),
          },
          result: Schema.Boolean,
          execute: Effect.gen(function* () {
            const rows =
              yield* sql`UPDATE enrichment_settings SET enabled = ${input.enabled}, warning_minor = ${input.warning?.minor ?? null},
                auto_apply_confidence = ${input.autoApplyConfidence}, version = version + 1 WHERE id = 1 AND version = ${input.expectedVersion} RETURNING id`;
            if (rows.length === 0)
              return yield* new FinanceError({
                kind: "stale",
                message: "These settings changed. Review them and save again.",
              });
            return true;
          }),
        });
      }, toFinanceError);

      const request = Effect.fn("Enrichment.request")(function* (
        input: typeof RequestEnrichment.Type,
      ) {
        if ((yield* activeRuns).some((run) => run.status === "pending" || run.status === "running"))
          return yield* new FinanceError({
            kind: "conflict",
            message: "Counterparty identification is already running.",
          });
        const run = yield* commands.run({
          commandId: input.commandId,
          input: { operation: "requestEnrichment", ...input },
          result: Schema.toCodecJson(EnrichmentRun),
          execute: provide(
            Effect.gen(function* () {
              yield* ensureEnabled;
              // Aliases without a counterparty, largest amounts first. Amounts order
              // the work here and never reach the model.
              const aliases =
                yield* sql`SELECT d.alias_key AS "aliasKey" FROM posting_descriptors d JOIN postings p ON p.id = d.posting_id
                  LEFT JOIN counterparty_aliases a ON a.alias_key = d.alias_key
                  WHERE d.counterparty_text IS NOT NULL AND a.alias_key IS NULL
                  GROUP BY d.alias_key ORDER BY sum(abs(p.amount_minor)) DESC, d.alias_key`.pipe(
                  Effect.flatMap(
                    Schema.decodeUnknownEffect(
                      Schema.Array(Schema.Struct({ aliasKey: Schema.String })),
                    ),
                  ),
                );
              const id = EnrichmentRunId.make(input.commandId);
              yield* sql`INSERT INTO enrichment_runs (id, purpose, status, model, requested) VALUES (${id}, 'identify', ${aliases.length > 0 ? "pending" : "completed"}, ${config.provider.model}, ${aliases.length})`;
              if (aliases.length > 0)
                yield* sql`INSERT INTO enrichment_items ${sql.insert(aliases.map((row, position) => ({ run_id: id, alias_key: row.aliasKey, position })))}`;
              return yield* readRun(id);
            }),
          ),
        });
        if (run.status === "pending") yield* jobs.start({ runId: run.id });
        return run;
      }, toFinanceError);

      // Asks the model about every alias of a counterparty you set, scored against your
      // answer. It uses the same Workflow, limits, and usage records as identification.
      const evaluate = Effect.fn("Enrichment.evaluate")(function* (
        input: typeof RequestEvaluation.Type,
      ) {
        if ((yield* activeRuns).some((run) => run.status === "pending" || run.status === "running"))
          return yield* new FinanceError({
            kind: "conflict",
            message: "Counterparty identification is already running.",
          });
        const run = yield* commands.run({
          commandId: input.commandId,
          input: { operation: "requestEvaluation", ...input },
          result: Schema.toCodecJson(EnrichmentRun),
          execute: provide(
            Effect.gen(function* () {
              yield* ensureEnabled;
              const answers =
                yield* sql`SELECT a.alias_key AS "aliasKey", c.id AS "counterpartyId", c.name, c.kind,
                    COALESCE(k.slug, k.id::text) AS "categoryKey", COALESCE(t.slug, t.id::text) AS "topCategoryKey"
                  FROM counterparty_aliases a JOIN counterparties c ON c.id = a.counterparty_id
                  LEFT JOIN categories k ON k.id = c.default_category_id
                  LEFT JOIN categories t ON t.id = COALESCE(k.parent_id, k.id)
                  WHERE c.source = 'user' AND a.status = 'applied' AND EXISTS (
                    SELECT 1 FROM posting_descriptors d WHERE d.alias_key = a.alias_key AND d.counterparty_text IS NOT NULL)
                  ORDER BY a.alias_key`.pipe(
                  Effect.flatMap(
                    Schema.decodeUnknownEffect(
                      Schema.Array(
                        Schema.Struct({
                          aliasKey: Schema.String,
                          counterpartyId: CounterpartyId,
                          ...EvaluationAnswer.fields,
                        }),
                      ),
                    ),
                  ),
                );
              const id = EnrichmentRunId.make(input.commandId);
              yield* sql`INSERT INTO enrichment_runs (id, purpose, status, model, requested) VALUES (${id}, 'evaluate', ${answers.length > 0 ? "pending" : "completed"}, ${config.provider.model}, ${answers.length})`;
              if (answers.length > 0) {
                yield* sql`INSERT INTO enrichment_items ${sql.insert(answers.map((row, position) => ({ run_id: id, alias_key: row.aliasKey, position })))}`;
                yield* sql`INSERT INTO enrichment_evaluations (run_id, alias_key, counterparty_id, expected)
                  SELECT ${id}, x."aliasKey", x."counterpartyId", x.expected
                  FROM jsonb_to_recordset(${sql.json(
                    answers.map(({ aliasKey, counterpartyId, ...expected }) => ({
                      aliasKey,
                      counterpartyId,
                      expected,
                    })),
                  )}) AS x("aliasKey" text, "counterpartyId" uuid, expected jsonb)`;
              }
              return yield* readRun(id);
            }),
          ),
        });
        if (run.status === "pending") yield* jobs.start({ runId: run.id });
        return run;
      }, toFinanceError);

      const runs = readRuns(sql`true`).pipe(
        Effect.provideService(PgClient.PgClient, sql),
        Effect.flatMap((rows) => Effect.forEach(rows, refresh, { concurrency: 4 })),
        toFinanceError,
      );

      const batch = Effect.fn("Enrichment.batch")(function* ({
        runId,
      }: typeof EnrichmentInput.Type) {
        return yield* sql.withTransaction(
          provide(
            Effect.gen(function* () {
              yield* sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`;
              const run = yield* readRun(runId);
              const settings = yield* ensureEnabled;
              if (run.model !== settings.provider.model)
                return yield* new FinanceError({
                  kind: "unavailable",
                  message: "The configured model changed. Start a new run.",
                });
              const aliases =
                run.status === "completed" || run.status === "failed"
                  ? []
                  : yield* sql`SELECT i.alias_key AS "aliasKey",
                        ${descriptorSamples(sql, sql("i.alias_key"))} AS samples,
                        ARRAY(SELECT DISTINCT d.channel FROM posting_descriptors d WHERE d.alias_key = i.alias_key ORDER BY 1) AS channels,
                        ARRAY(SELECT DISTINCT CASE WHEN p.amount_minor < 0 THEN 'out' ELSE 'in' END FROM posting_descriptors d JOIN postings p ON p.id = d.posting_id WHERE d.alias_key = i.alias_key ORDER BY 1) AS directions,
                        ARRAY(SELECT DISTINCT a.kind FROM posting_descriptors d JOIN postings p ON p.id = d.posting_id JOIN accounts a ON a.id = p.account_id WHERE d.alias_key = i.alias_key ORDER BY 1) AS "accountKinds",
                        ARRAY(SELECT DISTINCT a.institution FROM posting_descriptors d JOIN postings p ON p.id = d.posting_id JOIN accounts a ON a.id = p.account_id WHERE d.alias_key = i.alias_key ORDER BY 1) AS institutions,
                        (SELECT count(*)::int FROM posting_descriptors d WHERE d.alias_key = i.alias_key) AS "transactionCount"
                      FROM enrichment_items i WHERE i.run_id = ${runId} AND i.status = 'pending' ORDER BY i.position LIMIT ${batchSize}`.pipe(
                      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(EnrichmentAlias))),
                    );
              if (run.status === "pending")
                yield* sql`UPDATE enrichment_runs SET status = 'running' WHERE id = ${runId}`;
              if (aliases.length === 0 && run.status !== "failed")
                yield* sql`UPDATE enrichment_runs SET status = 'completed' WHERE id = ${runId}`;
              const hidden =
                run.purpose === "evaluate" && aliases.length > 0
                  ? (yield* sql`SELECT DISTINCT counterparty_id AS id FROM enrichment_evaluations WHERE run_id = ${runId} AND ${sql.in(
                      "alias_key",
                      aliases.map((alias) => alias.aliasKey),
                    )}`.pipe(
                      Effect.flatMap(
                        Schema.decodeUnknownEffect(
                          Schema.Array(Schema.Struct({ id: CounterpartyId })),
                        ),
                      ),
                    )).map((row) => row.id)
                  : [];
              return {
                commandId: CommandId.make(yield* crypto.randomUUIDv4),
                runId,
                aliases,
                ...(yield* readBatchContext(hidden)),
                provider: settings.provider,
              } satisfies typeof EnrichmentBatch.Type;
            }),
          ),
        );
      }, toFinanceError);

      const complete = Effect.fn("Enrichment.complete")(function* (
        input: typeof CompleteEnrichmentBatch.Type,
      ) {
        return yield* commands.run({
          commandId: input.commandId,
          input: {
            operation: "completeEnrichmentBatch",
            input: yield* Schema.encodeEffect(Schema.toCodecJson(CompleteEnrichmentBatch))(input),
          },
          result: Schema.Boolean,
          execute: provide(
            Effect.gen(function* () {
              const run = yield* readRun(input.runId);
              const settings = yield* readSettings;
              const report = input.report;
              yield* sql`INSERT INTO model_usage (id, task, model, input_tokens, output_tokens, cost_minor, cost_currency, status)
                VALUES (${yield* crypto.randomUUIDv4}, ${run.purpose === "evaluate" ? "evaluation" : "enrichment"}, ${run.model}, ${report.inputTokens}, ${report.outputTokens},
                  ${report.cost?.minor ?? null}, ${report.cost?.currency ?? null}, ${report.status})`;
              const pending = new Set(
                (yield* sql`SELECT alias_key AS "aliasKey" FROM enrichment_items WHERE run_id = ${input.runId} AND status = 'pending' AND ${sql.in("alias_key", input.aliasKeys)}`.pipe(
                  Effect.flatMap(
                    Schema.decodeUnknownEffect(
                      Schema.Array(Schema.Struct({ aliasKey: Schema.String })),
                    ),
                  ),
                )).map((row) => row.aliasKey),
              );
              // A failed batch leaves its aliases for a later run and its reason on the
              // run; the Workflow decides when repeated failures stop the run.
              if (report.status === "failed") {
                yield* sql`UPDATE enrichment_items SET status = 'failed' WHERE run_id = ${input.runId} AND ${sql.in("alias_key", [...pending])}`;
                yield* sql`UPDATE enrichment_runs SET failure = ${report.failure} WHERE id = ${input.runId}`;
                return true;
              }
              if (run.purpose === "evaluate") {
                const answered = report.results.filter(
                  (result, index) =>
                    pending.has(result.aliasKey) &&
                    report.results.findIndex((item) => item.aliasKey === result.aliasKey) === index,
                );
                yield* sql`UPDATE enrichment_evaluations e SET predicted = jsonb_build_object('name', x.name, 'kind', x.kind,
                    'categoryKey', COALESCE(k.slug, k.id::text), 'topCategoryKey', COALESCE(t.slug, t.id::text), 'confidence', x.confidence)
                  FROM jsonb_to_recordset(${sql.json(
                    answered.map((result) => ({
                      aliasKey: result.aliasKey,
                      name: result.name,
                      kind: result.kind,
                      categoryKey: result.categoryKey,
                      confidence: result.confidence,
                    })),
                  )}) AS x("aliasKey" text, name text, kind text, "categoryKey" text, confidence float8)
                  LEFT JOIN categories k ON NOT k.archived AND (k.slug = x."categoryKey" OR k.id::text = x."categoryKey")
                  LEFT JOIN categories t ON t.id = COALESCE(k.parent_id, k.id)
                  WHERE e.run_id = ${input.runId} AND e.alias_key = x."aliasKey"`;
                const keys = answered.map((result) => result.aliasKey);
                yield* sql`UPDATE enrichment_items SET status = CASE WHEN ${sql.in("alias_key", keys)} THEN 'resolved' ELSE 'skipped' END
                  WHERE run_id = ${input.runId} AND ${sql.in("alias_key", [...pending])}`;
                return true;
              }
              const resolved: string[] = [];
              for (const result of report.results) {
                if (!pending.has(result.aliasKey) || resolved.includes(result.aliasKey)) continue;
                yield* applyResult({
                  result,
                  model: run.model,
                  threshold: settings.autoApplyConfidence,
                });
                resolved.push(result.aliasKey);
              }
              yield* sql`UPDATE enrichment_items SET status = CASE WHEN ${sql.in("alias_key", resolved)} THEN 'resolved' ELSE 'skipped' END
                WHERE run_id = ${input.runId} AND ${sql.in("alias_key", [...pending])}`;
              const affected =
                resolved.length === 0
                  ? []
                  : yield* sql`SELECT e.id FROM events e JOIN posting_descriptors d ON d.posting_id = e.primary_posting_id WHERE e.active AND d.alias_key = ANY(${resolved}::text[])`.pipe(
                      Effect.flatMap(
                        Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ id: EventId }))),
                      ),
                    );
              yield* reinterpret(affected.map((row) => row.id));
              return true;
            }),
          ),
        });
      }, toFinanceError);

      const fail = Effect.fn("Enrichment.fail")(function* (input: typeof FailEnrichment.Type) {
        yield* sql`UPDATE enrichment_runs SET status = 'failed', failure = ${input.message} WHERE id = ${input.runId} AND status IN ('pending', 'running')`;
        return true;
      }, toFinanceError);

      // Counterparties the model placed in the proposal's parent or one of its
      // subcategories, reached through the aliases that prompted the proposal.
      const movable = (proposalId: Statement.Fragment) =>
        sql`SELECT DISTINCT cp.id, cp.name FROM category_proposals q
          JOIN counterparty_aliases a ON a.alias_key = ANY(q.alias_keys)
          JOIN counterparties cp ON cp.id = a.counterparty_id
          JOIN categories dc ON dc.id = cp.default_category_id
          WHERE q.id = ${proposalId} AND cp.source = 'model'
            AND (dc.id = q.parent_id OR dc.parent_id = q.parent_id)`;

      const proposals =
        sql`SELECT p.id, p.parent_id AS "parentId", c.name AS "parentName", p.name, p.reason, p.alias_keys AS "aliasKeys",
            COALESCE((SELECT jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name) ORDER BY m.name) FROM (${movable(sql`p.id`)}) m), '[]'::jsonb) AS counterparties,
            ${instant(sql, sql("p.created_at"))} AS "createdAt"
          FROM category_proposals p JOIN categories c ON c.id = p.parent_id WHERE p.status = 'proposed' ORDER BY cardinality(p.alias_keys) DESC, p.created_at`.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(CategoryProposals)),
          toFinanceError,
        );

      // Accepting creates the subcategory and moves the model's counterparties into it;
      // their transactions follow unless you categorised one yourself.
      const resolveProposal = Effect.fn("Enrichment.resolveProposal")(function* (
        input: typeof ResolveCategoryProposal.Type,
      ) {
        return yield* commands.run({
          commandId: input.commandId,
          input: { operation: "resolveCategoryProposal", ...input },
          result: CategoryProposalOutcome,
          execute: provide(
            Effect.gen(function* () {
              const [proposal] =
                yield* sql`SELECT p.parent_id AS "parentId", p.name, c.tree FROM category_proposals p JOIN categories c ON c.id = p.parent_id
                  WHERE p.id = ${input.proposalId} AND p.status = 'proposed' FOR UPDATE OF p`.pipe(
                  Effect.flatMap(
                    Schema.decodeUnknownEffect(
                      Schema.Array(
                        Schema.Struct({
                          parentId: CategoryId,
                          name: Schema.String,
                          tree: Schema.String,
                        }),
                      ),
                    ),
                  ),
                );
              if (!proposal)
                return yield* new FinanceError({
                  kind: "stale",
                  message: "This suggestion was already answered. Refresh the list.",
                });
              if (input.decision === "dismiss") {
                yield* sql`UPDATE category_proposals SET status = 'dismissed' WHERE id = ${input.proposalId}`;
                return { categoryId: null, moved: 0 };
              }
              const categoryId = CategoryId.make(yield* crypto.randomUUIDv4);
              yield* sql`INSERT INTO categories (id, name, tree, parent_id) VALUES (${categoryId}, ${proposal.name}, ${proposal.tree}, ${proposal.parentId})`;
              const moved = yield* readCounterpartyRecords(
                sql`id IN (SELECT m.id FROM (${movable(sql`${input.proposalId}::uuid`)}) m)`,
              );
              const images = {
                ...noImages,
                counterparties: moved.map((before) => ({
                  before,
                  after: { ...before, defaultCategoryId: categoryId, version: before.version + 1 },
                })),
              };
              yield* applyImages(images);
              if (moved.length > 0)
                yield* recordChange({
                  commandId: input.commandId,
                  kind: "acceptCategory",
                  undoes: null,
                  images,
                });
              yield* sql`UPDATE category_proposals SET status = 'accepted' WHERE id = ${input.proposalId}`;
              return { categoryId, moved: moved.length };
            }),
          ),
        });
      }, toFinanceError);

      return Enrichment.of({
        settings,
        configure,
        request,
        runs,
        batch,
        complete,
        fail,
        proposals,
        resolveProposal,
        evaluate,
      });
    }),
  );
}

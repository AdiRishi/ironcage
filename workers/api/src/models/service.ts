import { PgClient } from "@effect/sql-pg";
import {
  FinanceError,
  ModelAllowance,
  ModelAllowanceInput,
  ModelSettings,
  ModelUsage,
  ModelUsageEntry,
  RecordModelUsage,
  UpdateModelSettings,
} from "@repo/contracts/finance";
import { Context, Effect, Layer, Schema } from "effect";

import { Commands } from "../database/commands.ts";
import { toFinanceError } from "../database/failures.ts";
import { readTransaction } from "../database/transactions.ts";
import { ModelProviders } from "../platform/services.ts";
import {
  insertModelUsage,
  readModelAllowance,
  readModelSettings,
  readModelUsage,
} from "./repository.ts";

export class Models extends Context.Service<
  Models,
  {
    readonly settings: Effect.Effect<ModelSettings, FinanceError>;
    readonly updateSettings: (
      input: typeof UpdateModelSettings.Type,
    ) => Effect.Effect<ModelSettings, FinanceError>;
    readonly allowance: (
      input: typeof ModelAllowanceInput.Type,
    ) => Effect.Effect<typeof ModelAllowance.Type, FinanceError>;
    readonly record: (
      input: typeof RecordModelUsage.Type,
    ) => Effect.Effect<typeof ModelUsageEntry.Type, FinanceError>;
    readonly usage: Effect.Effect<typeof ModelUsage.Type, FinanceError>;
  }
>()("@repo/api/models/Models") {
  static readonly layer = Layer.effect(
    Models,
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      const commands = yield* Commands;
      const providers = yield* ModelProviders;
      const provide = <A, E>(effect: Effect.Effect<A, E, PgClient.PgClient | ModelProviders>) =>
        effect.pipe(
          Effect.provideService(PgClient.PgClient, sql),
          Effect.provideService(ModelProviders, providers),
        );

      const settings = readModelSettings.pipe(
        provide,
        toFinanceError,
        Effect.withSpan("Models.settings"),
      );

      const updateSettings = Effect.fn("Models.updateSettings")(function* (
        input: typeof UpdateModelSettings.Type,
      ) {
        if (input.warning && (input.warning.currency !== "USD" || input.warning.minor <= 0n))
          return yield* new FinanceError({
            kind: "invalid",
            message: "Use a positive USD usage warning.",
          });
        return yield* commands.run({
          commandId: input.commandId,
          input: {
            operation: "updateModelSettings",
            input: yield* Schema.encodeEffect(Schema.toCodecJson(UpdateModelSettings))(input),
          },
          result: Schema.toCodecJson(ModelSettings),
          execute: provide(
            Effect.gen(function* () {
              const rows =
                yield* sql`UPDATE model_settings SET enrichment_enabled = ${input.enrichment.enabled},
                  auto_apply_confidence = ${input.enrichment.autoApplyConfidence}, analyst_enabled = ${input.analyst.enabled},
                  warning_minor = ${input.warning?.minor ?? null}, version = version + 1
                  WHERE id = 1 AND version = ${input.expectedVersion} RETURNING id`;
              if (rows.length === 0)
                return yield* new FinanceError({
                  kind: "stale",
                  message: "These settings changed. Review them and save again.",
                });
              return yield* readModelSettings;
            }),
          ),
        });
      }, toFinanceError);

      const allowance = Effect.fn("Models.allowance")(function* ({
        task,
      }: typeof ModelAllowanceInput.Type) {
        return yield* readTransaction(sql, readModelAllowance(task)).pipe(provide);
      }, toFinanceError);

      const record = Effect.fn("Models.record")(function* (input: typeof RecordModelUsage.Type) {
        return yield* commands.run({
          commandId: input.commandId,
          input: {
            operation: "recordModelUsage",
            input: yield* Schema.encodeEffect(Schema.toCodecJson(RecordModelUsage))(input),
          },
          result: Schema.toCodecJson(ModelUsageEntry),
          execute: insertModelUsage(input).pipe(provide),
        });
      }, toFinanceError);

      const usage = readTransaction(sql, readModelUsage).pipe(
        provide,
        toFinanceError,
        Effect.withSpan("Models.usage"),
      );

      return Models.of({ settings, updateSettings, allowance, record, usage });
    }),
  );
}

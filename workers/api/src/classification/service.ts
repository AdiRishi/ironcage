import { PgClient } from "@effect/sql-pg";
import {
  AcceptanceSummary,
  EventInput,
  CategorySuggestion,
  AcceptSuggestions,
  ClassificationBatch,
  ClassificationInput,
  ClassificationRun,
  ClassificationRuns,
  ClassificationSettings,
  CompleteClassificationBatch,
  FailClassification,
  FinanceError,
  SuggestCategories,
  SuggestionList,
  UpdateClassificationSettings,
} from "@repo/contracts/finance";
import { Context, Crypto, Effect, Layer, Schema } from "effect";

import { Commands } from "../database/commands.ts";
import { toFinanceError } from "../database/failures.ts";
import { ClassificationJobs } from "../platform/services.ts";
import { ClassificationConfig } from "./config.ts";
import {
  nextClassificationBatch,
  requestClassification,
  updateClassificationSettings,
} from "./jobs.ts";
import { classificationRuns, classificationSettings } from "./repository.ts";
import {
  acceptSuggestions,
  completeClassificationBatch,
  failClassification,
  listSuggestions,
} from "./results.ts";
export class Classification extends Context.Service<
  Classification,
  {
    readonly suggestion: (
      input: typeof EventInput.Type,
    ) => Effect.Effect<typeof CategorySuggestion.Type | null, FinanceError>;
    readonly settings: Effect.Effect<typeof ClassificationSettings.Type, FinanceError>;
    readonly runs: Effect.Effect<typeof ClassificationRuns.Type, FinanceError>;
    readonly suggestions: Effect.Effect<typeof SuggestionList.Type, FinanceError>;
    readonly configure: (
      input: typeof UpdateClassificationSettings.Type,
    ) => Effect.Effect<boolean, FinanceError>;
    readonly request: (
      input: typeof SuggestCategories.Type,
    ) => Effect.Effect<typeof ClassificationRun.Type, FinanceError>;
    readonly batch: (
      input: typeof ClassificationInput.Type,
    ) => Effect.Effect<typeof ClassificationBatch.Type, FinanceError>;
    readonly complete: (
      input: typeof CompleteClassificationBatch.Type,
    ) => Effect.Effect<boolean, FinanceError>;
    readonly fail: (input: typeof FailClassification.Type) => Effect.Effect<void, FinanceError>;
    readonly accept: (
      input: typeof AcceptSuggestions.Type,
    ) => Effect.Effect<typeof AcceptanceSummary.Type, FinanceError>;
  }
>()("@repo/api/Classification") {
  static readonly layer = Layer.effect(
    Classification,
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      const config = yield* ClassificationConfig;
      const jobs = yield* ClassificationJobs;
      const commands = yield* Commands;
      const crypto = yield* Crypto.Crypto;
      const provide = <A, E>(
        effect: Effect.Effect<
          A,
          E,
          PgClient.PgClient | ClassificationConfig | ClassificationJobs | Commands | Crypto.Crypto
        >,
      ) =>
        effect.pipe(
          Effect.provideService(PgClient.PgClient, sql),
          Effect.provideService(ClassificationConfig, config),
          Effect.provideService(ClassificationJobs, jobs),
          Effect.provideService(Commands, commands),
          Effect.provideService(Crypto.Crypto, crypto),
        );
      return Classification.of({
        suggestion: ({ eventId }) =>
          sql`SELECT suggestion FROM events WHERE id=${eventId} AND active`.pipe(
            Effect.flatMap(
              Schema.decodeUnknownEffect(
                Schema.Array(Schema.Struct({ suggestion: Schema.NullOr(CategorySuggestion) })),
              ),
            ),
            Effect.map((rows) => rows[0]?.suggestion ?? null),
            toFinanceError,
          ),
        settings: classificationSettings.pipe(provide, toFinanceError),
        runs: classificationRuns.pipe(provide, toFinanceError),
        suggestions: listSuggestions.pipe(provide, toFinanceError),
        configure: (input) => updateClassificationSettings(input).pipe(provide, toFinanceError),
        request: (input) => requestClassification(input).pipe(provide, toFinanceError),
        batch: (input) => nextClassificationBatch(input).pipe(provide, toFinanceError),
        complete: (input) => completeClassificationBatch(input).pipe(provide, toFinanceError),
        fail: (input) => failClassification(input).pipe(provide, toFinanceError),
        accept: (input) => acceptSuggestions(input).pipe(provide, toFinanceError),
      });
    }),
  );
}

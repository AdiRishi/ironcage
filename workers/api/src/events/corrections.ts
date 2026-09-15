import { PgClient } from "@effect/sql-pg";
import {
  ApplyCorrection,
  CorrectionHistory,
  CorrectionPreview,
  EventInput,
  FinancialEvent,
  FinanceError,
  PreviewCorrection,
  UndoCorrection,
} from "@repo/contracts/finance";
import { correctEvent } from "@repo/finance";
import { Context, Crypto, Effect, Layer, Schema } from "effect";

import { Commands } from "../database/commands.ts";
import { toFinanceError } from "../database/failures.ts";
import {
  checkEventVersions,
  correctionHistory,
  recordCorrection,
  writeEvent,
  validateEventRelationships,
} from "./correction-records.ts";
import { previewImpact } from "./impact.ts";
import { readEvent } from "./repository.ts";

export class Corrections extends Context.Service<
  Corrections,
  {
    readonly preview: (
      input: typeof PreviewCorrection.Type,
    ) => Effect.Effect<typeof CorrectionPreview.Type, FinanceError>;
    readonly apply: (
      input: typeof ApplyCorrection.Type,
    ) => Effect.Effect<FinancialEvent, FinanceError>;
    readonly undo: (
      input: typeof UndoCorrection.Type,
    ) => Effect.Effect<FinancialEvent, FinanceError>;
    readonly history: (
      input: typeof EventInput.Type,
    ) => Effect.Effect<typeof CorrectionHistory.Type, FinanceError>;
  }
>()("@repo/api/events/Corrections") {
  static readonly layer = Layer.effect(
    Corrections,
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      const crypto = yield* Crypto.Crypto;
      const commands = yield* Commands;
      const provide = <A, E>(effect: Effect.Effect<A, E, PgClient.PgClient | Crypto.Crypto>) =>
        effect.pipe(
          Effect.provideService(PgClient.PgClient, sql),
          Effect.provideService(Crypto.Crypto, crypto),
        );
      const preview = Effect.fn("Corrections.preview")(
        function* ({ change }: typeof PreviewCorrection.Type) {
          return yield* sql.withTransaction(
            Effect.gen(function* () {
              yield* sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`;
              const event = yield* readEvent(change.eventId);
              const accepted = yield* correctEvent(event, change);
              yield* validateEventRelationships(accepted);
              return {
                change,
                expectedVersions: [{ eventId: event.id, version: event.version }],
                impact: yield* previewImpact(event, accepted),
              } satisfies typeof CorrectionPreview.Type;
            }),
          );
        },
        provide,
        toFinanceError,
      );
      const apply = Effect.fn("Corrections.apply")(
        function* (input: typeof ApplyCorrection.Type) {
          return yield* commands.run({
            commandId: input.commandId,
            input: {
              operation: "applyCorrection",
              input: yield* Schema.encodeEffect(Schema.toCodecJson(ApplyCorrection))(input),
            },
            result: Schema.toCodecJson(FinancialEvent),
            execute: Effect.gen(function* () {
              const prior = yield* readEvent(input.change.eventId);
              yield* checkEventVersions([prior], input.expectedVersions);
              const accepted = yield* correctEvent(prior, input.change);
              yield* writeEvent(accepted);
              yield* recordCorrection({
                prior,
                accepted,
                commandId: input.commandId,
                scope: "event",
              });
              return accepted;
            }),
          });
        },
        provide,
        toFinanceError,
      );
      const undo = Effect.fn("Corrections.undo")(
        function* (input: typeof UndoCorrection.Type) {
          return yield* commands.run({
            commandId: input.commandId,
            input: { operation: "undoCorrection", ...input },
            result: Schema.toCodecJson(FinancialEvent),
            execute: Effect.gen(function* () {
              const [saved] =
                yield* sql`SELECT prior, accepted FROM corrections WHERE id = ${input.correctionId}`.pipe(
                  Effect.flatMap(
                    Schema.decodeUnknownEffect(
                      Schema.Array(
                        Schema.Struct({ prior: FinancialEvent, accepted: FinancialEvent }),
                      ),
                    ),
                  ),
                );
              if (!saved)
                return yield* new FinanceError({
                  kind: "notFound",
                  message: "Correction not found.",
                });
              const prior = yield* readEvent(saved.prior.id);
              yield* checkEventVersions([prior], input.expectedVersions);
              const accepted = yield* correctEvent(prior, {
                eventId: prior.id,
                kind: saved.prior.kind,
                purchaseOn: saved.prior.purchaseOn,
                allocations: saved.prior.allocations,
              });
              yield* writeEvent(accepted);
              yield* recordCorrection({
                prior,
                accepted,
                commandId: input.commandId,
                scope: "undo",
              });
              return accepted;
            }),
          });
        },
        provide,
        toFinanceError,
      );
      const history = Effect.fn("Corrections.history")(
        function* ({ eventId }: typeof EventInput.Type) {
          return yield* correctionHistory(eventId);
        },
        provide,
        toFinanceError,
      );
      return Corrections.of({ preview, apply, undo, history });
    }),
  );
}

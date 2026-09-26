import { PgClient } from "@effect/sql-pg";
import {
  ApplyCorrection,
  AssignEventCounterparty,
  Correction,
  type CorrectionId,
  CorrectionPreview,
  type CounterpartyId,
  type EventHistory,
  EventHistoryEntry,
  EventInput,
  type EventPreview,
  FinancialEvent,
  FinanceError,
  PreviewCorrection,
  type PreviewEventCounterparty,
  type PreviewUndoCorrection,
  UndoCorrection,
} from "@repo/contracts/finance";
import { assignCounterparty, correctEvent, restoreEvent } from "@repo/finance";
import { Context, Crypto, Effect, Layer, Predicate, Schema, Struct } from "effect";

import { previewImpacts, previewWrite } from "../analysis/preview.ts";
import { Commands } from "../database/commands.ts";
import { toFinanceError } from "../database/failures.ts";
import { readTransaction } from "../database/transactions.ts";
import { readCounterparty } from "../interpretation/counterparties.ts";
import {
  readChangeEntries,
  readCounterpartyNames,
} from "../interpretation/counterparty-history.ts";
import { disputedValues, reinterpret } from "../interpretation/engine.ts";
import {
  checkEventVersions,
  readCorrections,
  recordCorrection,
  writeEvent,
  validateEventRelationships,
} from "./correction-records.ts";
import { readEvent } from "./repository.ts";

// Gives an event the counterparty you chose, or with null returns it to the one its
// descriptor names, and derives what follows from that counterparty.
const assignWrite = Effect.fn("assignWrite")(function* (
  event: FinancialEvent,
  counterpartyId: typeof CounterpartyId.Type | null,
) {
  const sql = yield* PgClient.PgClient;
  const assigned = yield* assignCounterparty(event, counterpartyId);
  yield* sql`UPDATE events SET counterparty_id = ${assigned.counterpartyId}, counterparty_source = ${assigned.counterpartySource}, version = ${assigned.version} WHERE id = ${assigned.id}`;
  yield* reinterpret([assigned.id]);
  return yield* readEvent(assigned.id);
});

const readCorrection = Effect.fn("readCorrection")(function* (
  correctionId: typeof CorrectionId.Type,
) {
  const sql = yield* PgClient.PgClient;
  const [saved] = yield* sql`SELECT prior, change FROM corrections WHERE id = ${correctionId}`.pipe(
    Effect.flatMap(
      Schema.decodeUnknownEffect(
        Schema.Array(Correction.mapFields(Struct.pick(["prior", "change"]))),
      ),
    ),
  );
  if (!saved)
    return yield* new FinanceError({ kind: "notFound", message: "Correction not found." });
  return saved;
});

// Sets back the part of an event a correction changed, with the sources its values had
// then, and derives the rest again.
const undoWrite = Effect.fn("undoCorrectionWrite")(function* (
  event: FinancialEvent,
  { prior, change }: Pick<typeof Correction.Type, "prior" | "change">,
) {
  const sql = yield* PgClient.PgClient;
  if (change === "counterparty") {
    const counterpartyId = prior.counterpartySource === "user" ? prior.counterpartyId : null;
    if (
      counterpartyId &&
      (yield* sql`SELECT id FROM counterparties WHERE id = ${counterpartyId}`).length === 0
    )
      return yield* new FinanceError({
        kind: "conflict",
        message:
          "That counterparty was merged or removed. Use Change to choose who the transaction was with.",
      });
    return yield* assignWrite(event, counterpartyId);
  }
  const restored = yield* restoreEvent(event, prior);
  yield* writeEvent(restored);
  yield* reinterpret([restored.id]);
  return yield* readEvent(restored.id);
});

export class Corrections extends Context.Service<
  Corrections,
  {
    readonly preview: (
      input: typeof PreviewCorrection.Type,
    ) => Effect.Effect<typeof CorrectionPreview.Type, FinanceError>;
    readonly apply: (
      input: typeof ApplyCorrection.Type,
    ) => Effect.Effect<FinancialEvent, FinanceError>;
    readonly previewCounterparty: (
      input: typeof PreviewEventCounterparty.Type,
    ) => Effect.Effect<typeof EventPreview.Type, FinanceError>;
    readonly assignCounterparty: (
      input: typeof AssignEventCounterparty.Type,
    ) => Effect.Effect<FinancialEvent, FinanceError>;
    readonly previewUndo: (
      input: typeof PreviewUndoCorrection.Type,
    ) => Effect.Effect<typeof EventPreview.Type, FinanceError>;
    readonly undo: (
      input: typeof UndoCorrection.Type,
    ) => Effect.Effect<FinancialEvent, FinanceError>;
    readonly history: (
      input: typeof EventInput.Type,
    ) => Effect.Effect<typeof EventHistory.Type, FinanceError>;
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
              const accepted = yield* correctEvent(event, change, yield* disputedValues(event.id));
              yield* validateEventRelationships(accepted);
              return {
                change,
                expectedVersions: [{ eventId: event.id, version: event.version }],
                impacts: yield* previewImpacts({ before: [event], after: [accepted] }),
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
              const accepted = yield* correctEvent(
                prior,
                input.change,
                yield* disputedValues(prior.id),
              );
              yield* writeEvent(accepted);
              yield* recordCorrection({
                prior,
                accepted,
                commandId: input.commandId,
                action: "correct",
                change: "allocations",
              });
              return accepted;
            }),
          });
        },
        provide,
        toFinanceError,
      );
      const previewCounterparty = Effect.fn("Corrections.previewCounterparty")(
        function* ({ eventId, counterpartyId }: typeof PreviewEventCounterparty.Type) {
          return eventPreview(
            yield* previewWrite(
              Effect.gen(function* () {
                const prior = yield* readEvent(eventId);
                if (counterpartyId) yield* readCounterparty(counterpartyId);
                return { prior, after: yield* assignWrite(prior, counterpartyId) };
              }),
            ),
          );
        },
        provide,
        toFinanceError,
      );
      const assignCounterpartyCommand = Effect.fn("Corrections.assignCounterparty")(
        function* (input: typeof AssignEventCounterparty.Type) {
          return yield* commands.run({
            commandId: input.commandId,
            input: { operation: "assignEventCounterparty", ...input },
            result: Schema.toCodecJson(FinancialEvent),
            execute: Effect.gen(function* () {
              const prior = yield* readEvent(input.eventId);
              yield* checkEventVersions([prior], input.expectedVersions);
              if (input.counterpartyId) yield* readCounterparty(input.counterpartyId);
              const accepted = yield* assignWrite(prior, input.counterpartyId);
              yield* recordCorrection({
                prior,
                accepted,
                commandId: input.commandId,
                action: "correct",
                change: "counterparty",
              });
              return accepted;
            }),
          });
        },
        provide,
        toFinanceError,
      );
      const previewUndo = Effect.fn("Corrections.previewUndo")(
        function* ({ correctionId }: typeof PreviewUndoCorrection.Type) {
          return eventPreview(
            yield* previewWrite(
              Effect.gen(function* () {
                const saved = yield* readCorrection(correctionId);
                const prior = yield* readEvent(saved.prior.id);
                return { prior, after: yield* undoWrite(prior, saved) };
              }),
            ),
          );
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
              const saved = yield* readCorrection(input.correctionId);
              const prior = yield* readEvent(saved.prior.id);
              yield* checkEventVersions([prior], input.expectedVersions);
              const accepted = yield* undoWrite(prior, saved);
              yield* recordCorrection({
                prior,
                accepted,
                commandId: input.commandId,
                action: "undo",
                change: saved.change,
              });
              return accepted;
            }),
          });
        },
        provide,
        toFinanceError,
      );
      // The event's corrections and the counterparty changes that changed what it
      // means, newest first.
      const history = Effect.fn("Corrections.history")(
        function* ({ eventId }: typeof EventInput.Type) {
          return yield* readTransaction(
            sql,
            Effect.gen(function* () {
              const corrections = yield* readCorrections(eventId);
              const changes = yield* readChangeEntries(
                sql`c.id IN (SELECT ce.change_id FROM counterparty_change_events ce WHERE ce.event_id = ${eventId})`,
                null,
              );
              const entries = [
                ...corrections.map((correction) => ({ kind: "correction" as const, correction })),
                ...changes.map((change) => ({ kind: "counterparty" as const, change })),
              ].toSorted((a, b) => {
                const first = entryStamp(a);
                const second = entryStamp(b);
                return (
                  second.createdAt.localeCompare(first.createdAt) ||
                  second.id.localeCompare(first.id)
                );
              });
              return {
                entries,
                names: yield* readCounterpartyNames([
                  ...new Set(
                    corrections
                      .flatMap(({ prior, accepted }) => [
                        prior.counterpartyId,
                        accepted.counterpartyId,
                      ])
                      .filter(Predicate.isNotNull),
                  ),
                ]),
              } satisfies typeof EventHistory.Type;
            }),
          );
        },
        provide,
        toFinanceError,
      );
      return Corrections.of({
        preview,
        apply,
        previewCounterparty,
        assignCounterparty: assignCounterpartyCommand,
        previewUndo,
        undo,
        history,
      });
    }),
  );
}

// A previewed write's event as it leaves it, with the version it expects the event at.
function eventPreview({
  result,
  impacts,
}: {
  readonly result: { readonly prior: FinancialEvent; readonly after: FinancialEvent };
  readonly impacts: (typeof EventPreview.Type)["impacts"];
}): typeof EventPreview.Type {
  return {
    after: result.after,
    expectedVersions: [{ eventId: result.prior.id, version: result.prior.version }],
    impacts,
  };
}

// When an entry was written, and its ID for entries written at the same time.
const entryStamp = EventHistoryEntry.match({
  correction: ({ correction }) => correction,
  counterparty: ({ change }) => change,
});

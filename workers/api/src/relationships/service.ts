import { PgClient } from "@effect/sql-pg";
import {
  ApplyRelationship,
  EventInput,
  EventRelationships,
  FinanceError,
  ListRelationshipCandidates,
  PreviewRelationship,
  RelationshipCandidatePage,
  RelationshipPreview,
} from "@repo/contracts/finance";
import { Context, Crypto, Effect, Layer, Schema } from "effect";

import { Commands } from "../database/commands.ts";
import { toFinanceError } from "../database/failures.ts";
import { checkEventVersions } from "../events/correction-records.ts";
import { previewPeriod } from "../events/impact.ts";
import { relationshipCandidates } from "./candidates.ts";
import { planRelationship } from "./plan.ts";
import { readRelationships } from "./repository.ts";

export class Relationships extends Context.Service<
  Relationships,
  {
    readonly get: (
      input: typeof EventInput.Type,
    ) => Effect.Effect<typeof EventRelationships.Type, FinanceError>;
    readonly candidates: (
      input: typeof ListRelationshipCandidates.Type,
    ) => Effect.Effect<typeof RelationshipCandidatePage.Type, FinanceError>;
    readonly preview: (
      input: typeof PreviewRelationship.Type,
    ) => Effect.Effect<typeof RelationshipPreview.Type, FinanceError>;
    readonly apply: (input: typeof ApplyRelationship.Type) => Effect.Effect<boolean, FinanceError>;
  }
>()("@repo/api/Relationships") {
  static readonly layer = Layer.effect(
    Relationships,
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      const crypto = yield* Crypto.Crypto;
      const commands = yield* Commands;
      const provide = <A, E>(effect: Effect.Effect<A, E, PgClient.PgClient | Crypto.Crypto>) =>
        effect.pipe(
          Effect.provideService(PgClient.PgClient, sql),
          Effect.provideService(Crypto.Crypto, crypto),
        );
      const snapshot = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`;
            return yield* effect;
          }),
        );
      const get = Effect.fn("Relationships.get")(
        (input: typeof EventInput.Type) => snapshot(readRelationships(input.eventId)),
        provide,
        toFinanceError,
      );
      const candidates = Effect.fn("Relationships.candidates")(
        (input: typeof ListRelationshipCandidates.Type) => snapshot(relationshipCandidates(input)),
        provide,
        toFinanceError,
      );
      const preview = Effect.fn("Relationships.preview")(
        ({ change }: typeof PreviewRelationship.Type) =>
          snapshot(
            Effect.gen(function* () {
              const plan = yield* planRelationship(change);
              const dates = [
                ...new Map(
                  plan.before
                    .filter((event) => event.active)
                    .flatMap((event) => event.postings)
                    .map((posting) => [posting.postedOn.slice(0, 7), posting.postedOn]),
                ).values(),
              ];
              const impacts = yield* Effect.forEach(dates, (on) =>
                previewPeriod(plan.before, plan.after, plan.credits, on),
              );
              const [first, ...rest] = plan.before;
              return {
                change,
                events: plan.after,
                expectedVersions: [
                  { eventId: first.id, version: first.version },
                  ...rest.map((event) => ({ eventId: event.id, version: event.version })),
                ],
                impacts,
              } satisfies typeof RelationshipPreview.Type;
            }),
          ),
        provide,
        toFinanceError,
      );
      const apply = Effect.fn("Relationships.apply")(
        function* (input: typeof ApplyRelationship.Type) {
          return yield* commands.run({
            commandId: input.commandId,
            input: {
              operation: "applyRelationship",
              input: yield* Schema.encodeEffect(Schema.toCodecJson(ApplyRelationship))(input),
            },
            result: Schema.Boolean,
            execute: Effect.gen(function* () {
              const plan = yield* planRelationship(input.change);
              yield* checkEventVersions(plan.before, input.expectedVersions);
              yield* plan.execute;
              for (const event of plan.before)
                yield* sql`UPDATE review_items SET resolved_at=now(),resolution=${sql.json({ kind: input.change.kind })},version=version+1 WHERE ${event.id}::uuid=ANY(event_ids) AND kind='relationship' AND resolved_at IS NULL`;
              return true;
            }),
          });
        },
        provide,
        toFinanceError,
      );
      return Relationships.of({ get, candidates, preview, apply });
    }),
  );
}

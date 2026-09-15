import { PgClient } from "@effect/sql-pg";
import {
  DismissInterpretationReview,
  FinanceError,
  InterpretationReview,
  InterpretationReviewPage,
  ListInterpretationReviews,
  ProposeRelationships,
} from "@repo/contracts/finance";
import { Context, Effect, Layer, Schema } from "effect";

import { Commands } from "../database/commands.ts";
import { toFinanceError } from "../database/failures.ts";
import { proposeMovements } from "./proposals.ts";
export class InterpretationReviews extends Context.Service<
  InterpretationReviews,
  {
    readonly list: (
      input: typeof ListInterpretationReviews.Type,
    ) => Effect.Effect<typeof InterpretationReviewPage.Type, FinanceError>;
    readonly propose: (
      input: typeof ProposeRelationships.Type,
    ) => Effect.Effect<boolean, FinanceError>;
    readonly dismiss: (
      input: typeof DismissInterpretationReview.Type,
    ) => Effect.Effect<boolean, FinanceError>;
  }
>()("@repo/api/InterpretationReviews") {
  static readonly layer = Layer.effect(
    InterpretationReviews,
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      const commands = yield* Commands;
      const list = Effect.fn("InterpretationReviews.list")(function* (
        input: typeof ListInterpretationReviews.Type,
      ) {
        const cursor = input.cursor
          ? sql`AND (p.posted_on,r.id)<(${input.cursor.postedOn}::date,${input.cursor.id}::uuid)`
          : sql``;
        const rows =
          yield* sql`SELECT r.id,r.kind,r.event_ids AS "eventIds",p.id AS "postingId",p.description,p.posted_on::text AS "postedOn",r.version FROM review_items r JOIN events e ON e.id=r.event_ids[1] JOIN postings p ON p.id=e.primary_posting_id WHERE r.kind IN ('role','relationship','ruleConflict') AND r.resolved_at IS NULL AND e.active ${cursor} ORDER BY p.posted_on DESC,r.id DESC LIMIT 51`.pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(InterpretationReview))),
          );
        const last = rows[49];
        return {
          rows: rows.slice(0, 50),
          nextCursor: rows.length > 50 && last ? { id: last.id, postedOn: last.postedOn } : null,
        };
      }, toFinanceError);
      const propose = Effect.fn("InterpretationReviews.propose")(
        (input: typeof ProposeRelationships.Type) =>
          commands.run({
            commandId: input.commandId,
            input: { operation: "proposeRelationships", ...input },
            result: Schema.Boolean,
            execute: proposeMovements.pipe(
              Effect.as(true),
              Effect.provideService(PgClient.PgClient, sql),
            ),
          }),
        toFinanceError,
      );
      const dismiss = Effect.fn("InterpretationReviews.dismiss")(
        (input: typeof DismissInterpretationReview.Type) =>
          commands.run({
            commandId: input.commandId,
            input: { operation: "dismissInterpretationReview", ...input },
            result: Schema.Boolean,
            execute: Effect.gen(function* () {
              const rows =
                yield* sql`UPDATE review_items SET resolved_at=now(),resolution='{"kind":"dismissed"}',version=version+1 WHERE id=${input.reviewId} AND version=${input.expectedVersion} AND kind IN ('relationship','ruleConflict') AND resolved_at IS NULL RETURNING id`;
              if (rows.length === 0)
                return yield* new FinanceError({
                  kind: "stale",
                  message: "The review item changed. Refresh the review list.",
                });
              return true;
            }),
          }),
        toFinanceError,
      );
      return InterpretationReviews.of({ list, propose, dismiss });
    }),
  );
}

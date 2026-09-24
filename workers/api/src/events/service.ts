import { PgClient } from "@effect/sql-pg";
import {
  EventForPosting,
  EventId,
  EventInput,
  FinancialEvent,
  FinanceError,
  ReferenceData,
  ReinterpretationSummary,
  ReinterpretPostings,
} from "@repo/contracts/finance";
import { Context, Crypto, Effect, Layer, Schema } from "effect";

import { Commands } from "../database/commands.ts";
import { toFinanceError } from "../database/failures.ts";
import { interpretPending, reinterpret } from "../interpretation/engine.ts";
import { readReferenceData } from "../references/read.ts";
import { readEvent } from "./repository.ts";

export class Events extends Context.Service<
  Events,
  {
    readonly interpret: (
      input: typeof ReinterpretPostings.Type,
    ) => Effect.Effect<typeof ReinterpretationSummary.Type, FinanceError>;
    readonly get: (input: typeof EventInput.Type) => Effect.Effect<FinancialEvent, FinanceError>;
    readonly forPosting: (
      input: typeof EventForPosting.Type,
    ) => Effect.Effect<FinancialEvent | null, FinanceError>;
    readonly references: Effect.Effect<typeof ReferenceData.Type, FinanceError>;
  }
>()("@repo/api/events/Events") {
  static readonly layer = Layer.effect(
    Events,
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      const commands = yield* Commands;
      const crypto = yield* Crypto.Crypto;
      const interpret = Effect.fn("Events.interpret")(function* (
        input: typeof ReinterpretPostings.Type,
      ) {
        return yield* commands.run({
          commandId: input.commandId,
          input: { operation: "reinterpretPostings", ...input },
          result: ReinterpretationSummary,
          execute: Effect.gen(function* () {
            const pending = yield* interpretPending;
            const changed = yield* reinterpret("all");
            return { ...pending, changed: pending.changed + changed.length };
          }).pipe(
            Effect.provideService(PgClient.PgClient, sql),
            Effect.provideService(Crypto.Crypto, crypto),
          ),
        });
      }, toFinanceError);
      const get = Effect.fn("Events.get")(
        function* ({ eventId }: typeof EventInput.Type) {
          return yield* sql.withTransaction(
            Effect.gen(function* () {
              yield* sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`;
              return yield* readEvent(eventId);
            }),
          );
        },
        Effect.provideService(PgClient.PgClient, sql),
        toFinanceError,
      );
      const forPosting = Effect.fn("Events.forPosting")(
        function* ({ postingId }: typeof EventForPosting.Type) {
          return yield* sql.withTransaction(
            Effect.gen(function* () {
              yield* sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`;
              const [row] =
                yield* sql`SELECT event_id AS id FROM event_postings WHERE posting_id = ${postingId} AND active`.pipe(
                  Effect.flatMap(
                    Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ id: EventId }))),
                  ),
                );
              return row ? yield* readEvent(row.id) : null;
            }),
          );
        },
        Effect.provideService(PgClient.PgClient, sql),
        toFinanceError,
      );
      const references = sql
        .withTransaction(
          Effect.gen(function* () {
            yield* sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`;
            return yield* readReferenceData;
          }),
        )
        .pipe(Effect.provideService(PgClient.PgClient, sql), toFinanceError);
      return Events.of({
        interpret,
        get,
        forPosting,
        references,
      });
    }),
  );
}

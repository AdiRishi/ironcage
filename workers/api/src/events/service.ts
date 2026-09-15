import { PgClient } from "@effect/sql-pg";
import {
  AccountKind,
  EventForPosting,
  EventId,
  EventInput,
  FinancialEvent,
  FinanceError,
  InterpretationSummary,
  InterpretPostings,
  Posting,
  ReferenceData,
} from "@repo/contracts/finance";
import { allocationRole, sourceRole } from "@repo/finance";
import { Array as Arr, Context, Crypto, Effect, Layer, Schema } from "effect";

import { postingFields } from "../database/columns.ts";
import { Commands } from "../database/commands.ts";
import { toFinanceError } from "../database/failures.ts";
import { readEvent } from "./repository.ts";

export class Events extends Context.Service<
  Events,
  {
    readonly interpret: (
      input: typeof InterpretPostings.Type,
    ) => Effect.Effect<typeof InterpretationSummary.Type, FinanceError>;
    readonly get: (input: typeof EventInput.Type) => Effect.Effect<FinancialEvent, FinanceError>;
    readonly forPosting: (
      input: typeof EventForPosting.Type,
    ) => Effect.Effect<FinancialEvent | null, FinanceError>;
    readonly summary: Effect.Effect<typeof InterpretationSummary.Type, FinanceError>;
    readonly references: Effect.Effect<typeof ReferenceData.Type, FinanceError>;
  }
>()("@repo/api/events/Events") {
  static readonly layer = Layer.effect(
    Events,
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      const commands = yield* Commands;
      const crypto = yield* Crypto.Crypto;
      const summary = Effect.gen(function* () {
        const counts =
          yield* sql`SELECT kind AS role, count(*)::int AS count FROM events WHERE active GROUP BY kind ORDER BY kind`.pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(InterpretationSummary.fields.counts)),
          );
        const [row] =
          yield* sql`SELECT count(*)::int AS remaining FROM postings p WHERE NOT EXISTS (SELECT 1 FROM event_postings ep WHERE ep.posting_id = p.id AND ep.active)`.pipe(
            Effect.flatMap(
              Schema.decodeUnknownEffect(Schema.Tuple([Schema.Struct({ remaining: Schema.Int })])),
            ),
          );
        return { created: 0, counts, remaining: row.remaining };
      });
      const interpret = Effect.fn("Events.interpret")(function* (
        input: typeof InterpretPostings.Type,
      ) {
        return yield* commands.run({
          commandId: input.commandId,
          input: { operation: "interpretPostings", ...input },
          result: Schema.toCodecJson(InterpretationSummary),
          execute: Effect.gen(function* () {
            const scope = input.scope === "all" ? sql`true` : sql.in("p.id", input.scope);
            const postings =
              yield* sql`SELECT ${postingFields(sql)}, a.kind AS "accountKind" FROM postings p JOIN accounts a ON a.id = p.account_id WHERE ${scope} AND NOT EXISTS (SELECT 1 FROM event_postings ep WHERE ep.posting_id = p.id AND ep.active) ORDER BY p.id`.pipe(
                Effect.flatMap(
                  Schema.decodeUnknownEffect(
                    Schema.Array(Schema.Struct({ ...Posting.fields, accountKind: AccountKind })),
                  ),
                ),
              );
            for (const batch of Arr.chunksOf(postings, 500)) {
              const records = yield* Effect.forEach(
                batch,
                Effect.fn(function* (posting) {
                  const kind = sourceRole({
                    description: posting.description,
                    minor: posting.amount.minor,
                    accountKind: posting.accountKind,
                  });
                  const magnitude =
                    posting.amount.minor < 0n ? -posting.amount.minor : posting.amount.minor;
                  return {
                    event: {
                      id: yield* crypto.randomUUIDv4,
                      kind,
                      currency: posting.amount.currency,
                      magnitude_minor: magnitude.toString(),
                      primary_posting_id: posting.id,
                      reporting_account_id: posting.accountId,
                    },
                    allocationId: yield* crypto.randomUUIDv4,
                  };
                }),
              );
              yield* sql`INSERT INTO events ${sql.insert(records.map((record) => record.event))}`;
              yield* sql`INSERT INTO event_postings ${sql.insert(records.map(({ event }) => ({ event_id: event.id, posting_id: event.primary_posting_id })))}`;
              yield* sql`INSERT INTO allocations ${sql.insert(records.map(({ event, allocationId }) => ({ id: allocationId, event_id: event.id, role: allocationRole(event.kind), amount_minor: event.magnitude_minor })))}`;
              yield* sql`INSERT INTO review_items (id, kind, observation_ids, event_ids, question, candidates)
                SELECT gen_random_uuid(), 'role', '{}', ARRAY[id], '{"message":"Choose the financial role."}', '[]'
                FROM events WHERE ${sql.in(
                  "id",
                  records.map((record) => record.event.id),
                )} AND kind = 'unresolved'`;
            }
            return { ...(yield* summary), created: postings.length };
          }),
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
            const categories =
              yield* sql`SELECT id, parent_id AS "parentId", name, archived, version FROM categories ORDER BY name, id`.pipe(
                Effect.flatMap(Schema.decodeUnknownEffect(ReferenceData.fields.categories)),
              );
            const merchants =
              yield* sql`SELECT id, name, version, ARRAY(SELECT pattern FROM merchant_aliases WHERE merchant_id = m.id ORDER BY pattern) AS aliases FROM merchants m ORDER BY name, id`.pipe(
                Effect.flatMap(Schema.decodeUnknownEffect(ReferenceData.fields.merchants)),
              );
            const tags = yield* sql`SELECT id, name, version FROM tags ORDER BY name, id`.pipe(
              Effect.flatMap(Schema.decodeUnknownEffect(ReferenceData.fields.tags)),
            );
            const personalEvents =
              yield* sql`SELECT id, name, start_on::text AS "startOn", end_on::text AS "endOn", exclude_from_ordinary AS "excludeFromOrdinary", version FROM personal_events ORDER BY start_on, id`.pipe(
                Effect.flatMap(Schema.decodeUnknownEffect(ReferenceData.fields.personalEvents)),
              );
            return { categories, merchants, tags, personalEvents };
          }),
        )
        .pipe(toFinanceError);
      return Events.of({
        interpret,
        get,
        forPosting,
        summary: sql
          .withTransaction(
            Effect.gen(function* () {
              yield* sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`;
              return yield* summary;
            }),
          )
          .pipe(toFinanceError),
        references,
      });
    }),
  );
}

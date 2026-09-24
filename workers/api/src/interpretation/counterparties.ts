import { PgClient } from "@effect/sql-pg";
import {
  AssignEventCounterparty,
  Counterparty,
  CounterpartyAlias,
  CounterpartyDetail,
  CounterpartyId,
  CounterpartyInput,
  CounterpartyList,
  CounterpartyMonth,
  CounterpartySummary,
  EventId,
  FinanceError,
  FinancialEvent,
  ListCounterparties,
  MergeCounterparties,
  MoveAlias,
  SaveCounterparty,
} from "@repo/contracts/finance";
import { Context, Crypto, Effect, Layer, Schema } from "effect";
import type { Statement } from "effect/unstable/sql";

import { instant } from "../database/columns.ts";
import { Commands } from "../database/commands.ts";
import { toFinanceError } from "../database/failures.ts";
import { readEvent } from "../events/repository.ts";
import { reinterpret } from "./engine.ts";

const counterpartyColumns = (sql: PgClient.PgClient) =>
  sql`c.id, c.name, c.kind, c.brand, c.default_category_id AS "defaultCategoryId", c.default_role AS "defaultRole", c.source, c.status, c.model, c.confidence::float8 AS confidence, c.reason, c.version, ${instant(sql, sql("c.updated_at"))} AS "updatedAt"`;

export const readCounterparty = Effect.fn("readCounterparty")(function* (
  id: typeof CounterpartyId.Type,
) {
  const sql = yield* PgClient.PgClient;
  const [row] =
    yield* sql`SELECT ${counterpartyColumns(sql)} FROM counterparties c WHERE c.id = ${id}`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Counterparty))),
    );
  if (!row)
    return yield* new FinanceError({ kind: "notFound", message: "Counterparty not found." });
  return row;
});

// Events whose counterparty follows from these counterparties or alias keys.
const affectedEvents = Effect.fn("affectedEvents")(function* ({
  counterpartyIds,
  aliasKeys,
}: {
  counterpartyIds: readonly (typeof CounterpartyId.Type)[];
  aliasKeys: readonly string[];
}) {
  const sql = yield* PgClient.PgClient;
  const rows =
    yield* sql`SELECT e.id FROM events e LEFT JOIN posting_descriptors d ON d.posting_id = e.primary_posting_id
      WHERE e.active AND (${sql.in("e.counterparty_id", counterpartyIds)} OR ${sql.in("d.alias_key", aliasKeys)})`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ id: EventId })))),
    );
  return rows.map((row) => row.id);
});

const checkCategory = Effect.fn("checkCategory")(function* (categoryId: string | null) {
  if (!categoryId) return;
  const sql = yield* PgClient.PgClient;
  const rows = yield* sql`SELECT id FROM categories WHERE id = ${categoryId} AND NOT archived`;
  if (rows.length === 0)
    return yield* new FinanceError({ kind: "invalid", message: "Choose an active category." });
});

export class Counterparties extends Context.Service<
  Counterparties,
  {
    readonly list: (
      input: typeof ListCounterparties.Type,
    ) => Effect.Effect<typeof CounterpartyList.Type, FinanceError>;
    readonly get: (
      input: typeof CounterpartyInput.Type,
    ) => Effect.Effect<typeof CounterpartyDetail.Type, FinanceError>;
    readonly save: (
      input: typeof SaveCounterparty.Type,
    ) => Effect.Effect<Counterparty, FinanceError>;
    readonly merge: (
      input: typeof MergeCounterparties.Type,
    ) => Effect.Effect<Counterparty, FinanceError>;
    readonly moveAlias: (input: typeof MoveAlias.Type) => Effect.Effect<boolean, FinanceError>;
    readonly assignEvent: (
      input: typeof AssignEventCounterparty.Type,
    ) => Effect.Effect<FinancialEvent, FinanceError>;
  }
>()("@repo/api/interpretation/Counterparties") {
  static readonly layer = Layer.effect(
    Counterparties,
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      const crypto = yield* Crypto.Crypto;
      const commands = yield* Commands;
      const provide = <A, E>(effect: Effect.Effect<A, E, PgClient.PgClient | Crypto.Crypto>) =>
        effect.pipe(
          Effect.provideService(PgClient.PgClient, sql),
          Effect.provideService(Crypto.Crypto, crypto),
        );

      const summaries = (predicate: Statement.Fragment, input: typeof ListCounterparties.Type) => {
        const inPeriod = input.period
          ? sql`p.posted_on >= ${input.period.start}::date AND p.posted_on < ${input.period.endExclusive}::date`
          : sql`true`;
        return sql`SELECT ${counterpartyColumns(sql)},
            count(e.id) FILTER (WHERE ${inPeriod})::int AS "eventCount",
            jsonb_build_object('currency', ${input.currency}::text, 'minor', COALESCE(-sum(p.amount_minor) FILTER (WHERE ${inPeriod} AND p.amount_minor < 0), 0)::text) AS outflow,
            jsonb_build_object('currency', ${input.currency}::text, 'minor', COALESCE(sum(p.amount_minor) FILTER (WHERE ${inPeriod} AND p.amount_minor > 0), 0)::text) AS inflow,
            max(p.posted_on)::text AS "lastOn"
          FROM counterparties c
          LEFT JOIN events e ON e.counterparty_id = c.id AND e.active AND e.currency = ${input.currency}
          LEFT JOIN postings p ON p.id = e.primary_posting_id
          WHERE ${predicate}
          GROUP BY c.id
          ORDER BY COALESCE(-sum(p.amount_minor) FILTER (WHERE ${inPeriod} AND p.amount_minor < 0), 0) + COALESCE(sum(p.amount_minor) FILTER (WHERE ${inPeriod} AND p.amount_minor > 0), 0) DESC, c.name, c.id`.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(CounterpartySummary))),
        );
      };

      const list = Effect.fn("Counterparties.list")(function* (
        input: typeof ListCounterparties.Type,
      ) {
        const search = `%${input.search}%`;
        return yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`;
            return yield* summaries(
              input.search
                ? sql`(c.name ILIKE ${search} OR c.brand ILIKE ${search} OR EXISTS (SELECT 1 FROM counterparty_aliases a WHERE a.counterparty_id = c.id AND a.alias_key ILIKE ${search}))`
                : sql`true`,
              input,
            );
          }),
        );
      }, toFinanceError);

      const get = Effect.fn("Counterparties.get")(function* ({
        counterpartyId,
      }: typeof CounterpartyInput.Type) {
        return yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`;
            const [settings] =
              yield* sql`SELECT reporting_currency AS currency FROM settings WHERE id = 1`.pipe(
                Effect.flatMap(
                  Schema.decodeUnknownEffect(
                    Schema.Tuple([Schema.Struct({ currency: Schema.String })]),
                  ),
                ),
              );
            const [counterparty] = yield* summaries(sql`c.id = ${counterpartyId}`, {
              search: "",
              currency: settings.currency,
              period: null,
            });
            if (!counterparty)
              return yield* new FinanceError({
                kind: "notFound",
                message: "Counterparty not found.",
              });
            const aliases = yield* sql`SELECT a.alias_key AS "aliasKey", a.source,
                  ARRAY(SELECT DISTINCT d.counterparty_text FROM posting_descriptors d WHERE d.alias_key = a.alias_key AND d.counterparty_text IS NOT NULL LIMIT 3) AS samples,
                  (SELECT min(d.channel) FROM posting_descriptors d WHERE d.alias_key = a.alias_key) AS channel,
                  (SELECT count(*) FROM posting_descriptors d WHERE d.alias_key = a.alias_key)::int AS "eventCount"
                FROM counterparty_aliases a WHERE a.counterparty_id = ${counterpartyId} ORDER BY a.alias_key`.pipe(
              Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(CounterpartyAlias))),
            );
            const months = yield* sql`SELECT to_char(p.posted_on, 'YYYY-MM') AS month,
                  jsonb_build_object('currency', ${settings.currency}::text, 'minor', COALESCE(-sum(p.amount_minor) FILTER (WHERE p.amount_minor < 0), 0)::text) AS outflow,
                  jsonb_build_object('currency', ${settings.currency}::text, 'minor', COALESCE(sum(p.amount_minor) FILTER (WHERE p.amount_minor > 0), 0)::text) AS inflow
                FROM events e JOIN postings p ON p.id = e.primary_posting_id
                WHERE e.active AND e.counterparty_id = ${counterpartyId} AND p.currency = ${settings.currency}
                GROUP BY 1 ORDER BY 1`.pipe(
              Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(CounterpartyMonth))),
            );
            return { counterparty, aliases, months };
          }),
        );
      }, toFinanceError);

      const save = Effect.fn("Counterparties.save")(function* (
        input: typeof SaveCounterparty.Type,
      ) {
        return yield* commands.run({
          commandId: input.commandId,
          input: { operation: "saveCounterparty", ...input },
          result: Schema.toCodecJson(Counterparty),
          execute: provide(
            Effect.gen(function* () {
              yield* checkCategory(input.fields.defaultCategoryId);
              const fields = input.fields;
              let id: typeof CounterpartyId.Type;
              let aliasKeys: readonly string[] = [];
              if (input.target.kind === "create") {
                id = CounterpartyId.make(yield* crypto.randomUUIDv4);
                aliasKeys = input.target.aliasKeys;
                yield* sql`INSERT INTO counterparties (id, name, kind, brand, default_category_id, default_role, source, status) VALUES (${id}, ${fields.name}, ${fields.kind}, ${fields.brand}, ${fields.defaultCategoryId}, ${fields.defaultRole}, 'user', 'applied')`;
                for (const aliasKey of aliasKeys)
                  yield* sql`INSERT INTO counterparty_aliases (alias_key, counterparty_id, source) VALUES (${aliasKey}, ${id}, 'user') ON CONFLICT (alias_key) DO UPDATE SET counterparty_id = EXCLUDED.counterparty_id, source = 'user'`;
              } else {
                id = input.target.id;
                const current = yield* readCounterparty(id);
                if (current.version !== input.target.expectedVersion)
                  return yield* new FinanceError({
                    kind: "stale",
                    message: "This counterparty changed. Review it and save again.",
                  });
                yield* sql`UPDATE counterparties SET name = ${fields.name}, kind = ${fields.kind}, brand = ${fields.brand}, default_category_id = ${fields.defaultCategoryId}, default_role = ${fields.defaultRole}, source = 'user', status = 'applied', version = version + 1, updated_at = now() WHERE id = ${id}`;
              }
              yield* reinterpret(yield* affectedEvents({ counterpartyIds: [id], aliasKeys }));
              return yield* readCounterparty(id);
            }),
          ),
        });
      }, toFinanceError);

      const merge = Effect.fn("Counterparties.merge")(function* (
        input: typeof MergeCounterparties.Type,
      ) {
        return yield* commands.run({
          commandId: input.commandId,
          input: { operation: "mergeCounterparties", ...input },
          result: Schema.toCodecJson(Counterparty),
          execute: provide(
            Effect.gen(function* () {
              if (input.sourceId === input.targetId)
                return yield* new FinanceError({
                  kind: "invalid",
                  message: "Choose two different counterparties.",
                });
              const source = yield* readCounterparty(input.sourceId);
              const target = yield* readCounterparty(input.targetId);
              if (source.version !== input.sourceVersion || target.version !== input.targetVersion)
                return yield* new FinanceError({
                  kind: "stale",
                  message: "A counterparty changed. Review both and merge again.",
                });
              yield* sql`UPDATE counterparty_aliases SET counterparty_id = ${target.id}, source = 'user' WHERE counterparty_id = ${source.id}`;
              yield* sql`UPDATE events SET counterparty_id = ${target.id} WHERE counterparty_id = ${source.id}`;
              yield* sql`UPDATE rules SET conditions = jsonb_set(conditions, '{counterpartyId}', to_jsonb(${target.id}::text)) WHERE conditions->>'counterpartyId' = ${source.id}`;
              yield* sql`DELETE FROM counterparties WHERE id = ${source.id}`;
              yield* sql`UPDATE counterparties SET source = 'user', status = 'applied', version = version + 1, updated_at = now() WHERE id = ${target.id}`;
              yield* reinterpret(
                yield* affectedEvents({ counterpartyIds: [target.id], aliasKeys: [] }),
              );
              return yield* readCounterparty(target.id);
            }),
          ),
        });
      }, toFinanceError);

      const moveAlias = Effect.fn("Counterparties.moveAlias")(function* (
        input: typeof MoveAlias.Type,
      ) {
        return yield* commands.run({
          commandId: input.commandId,
          input: { operation: "moveAlias", ...input },
          result: Schema.Boolean,
          execute: provide(
            Effect.gen(function* () {
              yield* readCounterparty(input.counterpartyId);
              yield* sql`INSERT INTO counterparty_aliases (alias_key, counterparty_id, source) VALUES (${input.aliasKey}, ${input.counterpartyId}, 'user') ON CONFLICT (alias_key) DO UPDATE SET counterparty_id = EXCLUDED.counterparty_id, source = 'user'`;
              yield* reinterpret(
                yield* affectedEvents({ counterpartyIds: [], aliasKeys: [input.aliasKey] }),
              );
              return true;
            }),
          ),
        });
      }, toFinanceError);

      const assignEvent = Effect.fn("Counterparties.assignEvent")(function* (
        input: typeof AssignEventCounterparty.Type,
      ) {
        return yield* commands.run({
          commandId: input.commandId,
          input: { operation: "assignEventCounterparty", ...input },
          result: Schema.toCodecJson(FinancialEvent),
          execute: provide(
            Effect.gen(function* () {
              const event = yield* readEvent(input.eventId);
              if (event.version !== input.expectedVersion)
                return yield* new FinanceError({
                  kind: "stale",
                  message: "The transaction changed. Review it and try again.",
                });
              if (input.counterpartyId) yield* readCounterparty(input.counterpartyId);
              yield* sql`UPDATE events SET counterparty_id = ${input.counterpartyId}, counterparty_source = ${input.counterpartyId ? "user" : null}, version = version + 1 WHERE id = ${event.id}`;
              yield* reinterpret([event.id]);
              return yield* readEvent(event.id);
            }),
          ),
        });
      }, toFinanceError);

      return Counterparties.of({ list, get, save, merge, moveAlias, assignEvent });
    }),
  );
}

import { PgClient } from "@effect/sql-pg";
import {
  AccountId,
  ApplyCounterpartyChange,
  Counterparty,
  CounterpartyAlias,
  type CounterpartyChange,
  CounterpartyChangeOutcome,
  type CounterpartyChangePreview,
  CounterpartyDetail,
  CounterpartyId,
  CounterpartyInput,
  CounterpartyList,
  CounterpartyMonth,
  CounterpartyReference,
  DescriptorMatches,
  FinanceError,
  type FlowDirection,
  ListCounterparties,
  type PreviewCounterpartyChange,
  type SearchDescriptors,
} from "@repo/contracts/finance";
import { monthCoverage } from "@repo/finance";
import { Context, Crypto, Effect, Layer, Schema, Struct } from "effect";
import type { Statement } from "effect/unstable/sql";

import { coverageSources } from "../analysis/coverage.ts";
import { factsGoing, factsIn } from "../analysis/fact-sql.ts";
import { previewWrite } from "../analysis/preview.ts";
import { containsText, counterpartyColumns } from "../database/columns.ts";
import { Commands } from "../database/commands.ts";
import { toFinanceError } from "../database/failures.ts";
import { readTransaction } from "../database/transactions.ts";
import { readEvent } from "../events/repository.ts";
import { applyImages, isEmpty, planChange, recordChange } from "./counterparty-changes.ts";
import { aliasEventCount, descriptorSamples } from "./descriptors.ts";

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

// Plans a change, writes it, and reads the counterparty it leaves you on.
const writeChange = Effect.fn("writeCounterpartyChange")(function* (change: CounterpartyChange) {
  const { counterpartyId, images } = yield* planChange(change);
  yield* applyImages(images);
  return { images, counterparty: yield* readCounterparty(counterpartyId) };
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
    readonly searchDescriptors: (
      input: typeof SearchDescriptors.Type,
    ) => Effect.Effect<typeof DescriptorMatches.Type, FinanceError>;
    readonly preview: (
      input: typeof PreviewCounterpartyChange.Type,
    ) => Effect.Effect<typeof CounterpartyChangePreview.Type, FinanceError>;
    readonly apply: (
      input: typeof ApplyCounterpartyChange.Type,
    ) => Effect.Effect<typeof CounterpartyChangeOutcome.Type, FinanceError>;
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

      // A counterparty's amounts are its share of the flow: what it adds to the out
      // streams, with refunds reducing spending, and what it adds to the in streams.
      // Money moved between your own accounts is in neither. Each count is the
      // transactions behind that amount, so a refund counts toward the outflow it reduces.
      const inPeriod = (period: (typeof ListCounterparties.Type)["period"]) =>
        period ? factsIn(sql, "spending", period) : sql`true`;
      const amount = (
        period: (typeof ListCounterparties.Type)["period"],
        direction: FlowDirection,
      ) =>
        sql`COALESCE(sum(f.amount_minor) FILTER (WHERE ${inPeriod(period)} AND ${factsGoing(sql, direction)}), 0)`;
      const eventCount = (
        period: (typeof ListCounterparties.Type)["period"],
        direction: FlowDirection,
      ) =>
        sql`count(DISTINCT f.event_id) FILTER (WHERE ${inPeriod(period)} AND ${factsGoing(sql, direction)})::int`;
      const summaries = (
        { currency, period }: Pick<typeof ListCounterparties.Type, "currency" | "period">,
        where: Statement.Fragment,
        tail: Statement.Fragment,
      ) =>
        sql`SELECT ${counterpartyColumns(sql)},
            count(DISTINCT f.event_id) FILTER (WHERE ${inPeriod(period)} AND f.measure <> 'internal')::int AS "eventCount",
            ${eventCount(period, "out")} AS "outflowEvents",
            ${eventCount(period, "in")} AS "inflowEvents",
            jsonb_build_object('currency', ${currency}::text, 'minor', ${amount(period, "out")}::text) AS outflow,
            jsonb_build_object('currency', ${currency}::text, 'minor', ${amount(period, "in")}::text) AS inflow,
            max(f.spending_on) FILTER (WHERE f.measure <> 'internal')::text AS "lastOn"
          FROM counterparties c
          LEFT JOIN ledger_facts f ON f.counterparty_id = c.id AND f.currency = ${currency}
          WHERE ${where}
          GROUP BY c.id ${tail}`.pipe(Effect.flatMap(Schema.decodeUnknownEffect(CounterpartyList)));

      // A name or brand, one of its descriptors' alias keys, or the text the bank printed
      // for one of them.
      const matching = (search: string) =>
        search
          ? sql`(${containsText(sql, sql("c.name"), search)} OR ${containsText(sql, sql("c.brand"), search)}
              OR EXISTS (SELECT 1 FROM counterparty_aliases a WHERE a.counterparty_id = c.id AND a.status = 'applied'
                AND (${containsText(sql, sql("a.alias_key"), search)} OR EXISTS (SELECT 1 FROM posting_descriptors d
                  WHERE d.alias_key = a.alias_key AND ${containsText(sql, sql("d.counterparty_text"), search)}))))`
          : sql`true`;

      // Every counterparty with an amount in the tab's direction, largest first, so one
      // whose refunds exceed its purchases comes last.
      const list = Effect.fn("Counterparties.list")(function* (
        input: typeof ListCounterparties.Type,
      ) {
        const directed = amount(input.period, input.direction);
        return yield* readTransaction(
          sql,
          summaries(
            input,
            matching(input.search),
            sql`HAVING ${directed} <> 0 ORDER BY ${directed} DESC, c.name, c.id`,
          ),
        );
      }, toFinanceError);

      const get = Effect.fn("Counterparties.get")(
        function* ({ counterpartyId }: typeof CounterpartyInput.Type) {
          return yield* readTransaction(
            sql,
            Effect.gen(function* () {
              const [settings] =
                yield* sql`SELECT reporting_currency AS currency FROM settings WHERE id = 1`.pipe(
                  Effect.flatMap(
                    Schema.decodeUnknownEffect(
                      Schema.Tuple([Schema.Struct({ currency: Schema.String })]),
                    ),
                  ),
                );
              const [counterparty] = yield* summaries(
                { currency: settings.currency, period: null },
                sql`c.id = ${counterpartyId}`,
                sql``,
              );
              if (!counterparty)
                return yield* new FinanceError({
                  kind: "notFound",
                  message: "Counterparty not found.",
                });
              const aliases =
                yield* sql`SELECT a.alias_key AS "aliasKey", a.source, a.status, a.version,
                  ${descriptorSamples(sql, sql("a.alias_key"))} AS samples,
                  (SELECT min(d.channel) FROM posting_descriptors d WHERE d.alias_key = a.alias_key) AS channel,
                  ${aliasEventCount(sql, sql("a.alias_key"))} AS "eventCount"
                FROM counterparty_aliases a WHERE a.counterparty_id = ${counterpartyId} ORDER BY a.status = 'proposed', a.alias_key`.pipe(
                  Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(CounterpartyAlias))),
                );
              // Every month from the first to the last with records, so the history is
              // evenly spaced in time. A month's coverage counts only the accounts the
              // counterparty's transactions go through.
              const months = yield* sql`WITH monthly AS (
                  SELECT date_trunc('month', f.spending_on)::date AS month,
                    COALESCE(sum(f.amount_minor) FILTER (WHERE ${factsGoing(sql, "out")}), 0) AS outflow,
                    COALESCE(sum(f.amount_minor) FILTER (WHERE ${factsGoing(sql, "in")}), 0) AS inflow
                  FROM ledger_facts f
                  WHERE f.counterparty_id = ${counterpartyId} AND f.currency = ${settings.currency} AND f.measure <> 'internal'
                  GROUP BY 1)
                SELECT to_char(m.month, 'YYYY-MM') AS month,
                  jsonb_build_object('currency', ${settings.currency}::text, 'minor', COALESCE(monthly.outflow, 0)::text) AS outflow,
                  jsonb_build_object('currency', ${settings.currency}::text, 'minor', COALESCE(monthly.inflow, 0)::text) AS inflow
                FROM generate_series((SELECT min(month) FROM monthly), (SELECT max(month) FROM monthly), interval '1 month') AS m(month)
                LEFT JOIN monthly ON monthly.month = m.month
                ORDER BY m.month`.pipe(
                Effect.flatMap(
                  Schema.decodeUnknownEffect(
                    Schema.Array(CounterpartyMonth.mapFields(Struct.omit(["coverage"]))),
                  ),
                ),
              );
              const used = yield* sql`SELECT DISTINCT f.account_id AS id FROM ledger_facts f
                WHERE f.counterparty_id = ${counterpartyId} AND f.currency = ${settings.currency} AND f.measure <> 'internal'`.pipe(
                Effect.flatMap(
                  Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ id: AccountId }))),
                ),
              );
              const accountIds = new Set(used.map((row) => row.id));
              const sources = yield* coverageSources(settings.currency);
              const coverage = {
                ...sources,
                accounts: sources.accounts.filter((account) => accountIds.has(account.id)),
              };
              const references =
                yield* sql`SELECT d.reference_key AS "referenceKey", min(d.reference) AS sample,
                  count(*)::int AS "eventCount", r.default_role AS "defaultRole", r.default_category_id AS "defaultCategoryId", r.version
                FROM events e JOIN posting_descriptors d ON d.posting_id = e.primary_posting_id
                LEFT JOIN counterparty_references r ON r.counterparty_id = e.counterparty_id AND r.reference_key = d.reference_key
                WHERE e.active AND e.counterparty_id = ${counterpartyId} AND d.reference_key IS NOT NULL
                GROUP BY d.reference_key, r.default_role, r.default_category_id, r.version
                ORDER BY count(*) DESC, d.reference_key LIMIT 20`.pipe(
                  Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(CounterpartyReference))),
                );
              return {
                counterparty,
                aliases,
                months: months.map((month) => ({
                  ...month,
                  coverage: monthCoverage(coverage, month.month),
                })),
                references,
              };
            }),
          );
        },
        provide,
        toFinanceError,
      );

      // Alias keys whose printed text or key contains the search, or whose counterparty's
      // name does, with the counterparty that holds each. Descriptors already applied to
      // `excludeCounterpartyId` are left out.
      const searchDescriptors = Effect.fn("Counterparties.searchDescriptors")(function* ({
        search,
        excludeCounterpartyId,
      }: typeof SearchDescriptors.Type) {
        return yield* readTransaction(
          sql,
          sql`WITH keys AS (
              SELECT d.alias_key FROM posting_descriptors d
              WHERE d.alias_key IS NOT NULL
                AND (${containsText(sql, sql("d.counterparty_text"), search)} OR ${containsText(sql, sql("d.alias_key"), search)})
              UNION
              SELECT a.alias_key FROM counterparty_aliases a JOIN counterparties c ON c.id = a.counterparty_id
              WHERE ${containsText(sql, sql("c.name"), search)})
            SELECT k.alias_key AS "aliasKey", ${descriptorSamples(sql, sql("k.alias_key"))} AS samples,
              ${aliasEventCount(sql, sql("k.alias_key"))} AS "eventCount",
              CASE WHEN a.alias_key IS NULL THEN NULL ELSE jsonb_build_object('counterpartyId', a.counterparty_id,
                'counterpartyName', c.name, 'status', a.status, 'source', a.source, 'version', a.version) END AS alias
            FROM keys k
            LEFT JOIN counterparty_aliases a ON a.alias_key = k.alias_key
            LEFT JOIN counterparties c ON c.id = a.counterparty_id
            WHERE a.alias_key IS NULL OR a.status <> 'applied' OR a.counterparty_id IS DISTINCT FROM ${excludeCounterpartyId}::uuid
            ORDER BY "eventCount" DESC, k.alias_key LIMIT 20`.pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(DescriptorMatches)),
          ),
        );
      }, toFinanceError);

      const preview = Effect.fn("Counterparties.preview")(
        function* ({ change }: typeof PreviewCounterpartyChange.Type) {
          const { result, eventCount, impacts } = yield* previewWrite(
            Effect.gen(function* () {
              yield* writeChange(change);
              return change.kind === "moveAlias" && change.event
                ? yield* readEvent(change.event.eventId)
                : null;
            }),
          );
          return { change, eventCount, impacts, event: result };
        },
        provide,
        toFinanceError,
      );

      const apply = Effect.fn("Counterparties.apply")(
        function* (input: typeof ApplyCounterpartyChange.Type) {
          return yield* commands.run({
            commandId: input.commandId,
            input: { operation: "applyCounterpartyChange", ...input },
            result: Schema.toCodecJson(CounterpartyChangeOutcome),
            execute: Effect.gen(function* () {
              const { images, counterparty } = yield* writeChange(input.change);
              return {
                changeId: isEmpty(images)
                  ? null
                  : yield* recordChange({
                      commandId: input.commandId,
                      kind: input.change.kind,
                      undoes: null,
                      images,
                    }),
                counterparty,
              };
            }),
          });
        },
        provide,
        toFinanceError,
      );

      return Counterparties.of({ list, get, searchDescriptors, preview, apply });
    }),
  );
}

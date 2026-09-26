import { PgClient } from "@effect/sql-pg";
import {
  CountedLedgerRow,
  type CountedLedgerPage,
  type ListCountedLedger,
} from "@repo/contracts/finance";
import { measures, measureTotal } from "@repo/finance";
import { Effect, Schema } from "effect";

import { categoryNodes } from "../analysis/categories.ts";
import {
  categoryFacts,
  counterpartyFacts,
  factDate,
  factsGoing,
  factsIn,
  partFacts,
} from "../analysis/fact-sql.ts";
import { resolveSelection } from "../analysis/periods.ts";
import { scopePath } from "../analysis/scopes.ts";
import { questionEventsTable } from "../interpretation/question-events.ts";
import {
  allocationPredicates,
  ledgerMeaning,
  ledgerRowColumns,
  pageSize,
  postingPredicates,
} from "./ledger-rows.ts";

const PartTotal = Schema.Struct({
  part: Schema.Int,
  amount: Schema.BigIntFromString,
  postings: Schema.Int,
});

// The postings behind a counted scope in a period, with what each counts. A linked
// credit's reduction is its credit's primary posting, placed on the purchase's date.
export const countedLedger = Effect.fn("countedLedger")(function* ({
  scope,
  period,
  basis,
  currency,
  filter,
  cursor,
}: typeof ListCountedLedger.Type) {
  const sql = yield* PgClient.PgClient;
  const resolved = yield* resolveSelection(period);
  const path = yield* scopePath(yield* categoryNodes, scope);
  const parts = measures[scope.measure].parts;
  const partOf = parts.map((part, index) => sql`WHEN ${partFacts(sql, part)} THEN ${index}::int`);
  const questions = yield* questionEventsTable(null);
  // One row per record, part, and date. `amount` is what the facts add to the part, and
  // `counted` is the same money signed the way the bank booked it.
  const records = sql`WITH ${questions}, scoped AS (
      SELECT COALESCE(credit.primary_posting_id, f.posting_id) AS posting_id,
        CASE ${sql.join(" ", false)(partOf)} END AS part, ${factDate(sql, basis)} AS counted_on, f.amount_minor,
        CASE WHEN ${factsGoing(sql, "out")} THEN -f.amount_minor ELSE f.amount_minor END AS counted
      FROM ledger_facts f LEFT JOIN events credit ON credit.id = f.credit_event_id
      WHERE ${sql.and([
        sql`f.currency = ${currency}`,
        factsIn(sql, basis, resolved.period),
        sql.or(parts.map((part) => partFacts(sql, part))),
        categoryFacts(sql, scope.category),
        counterpartyFacts(sql, scope.counterparty),
        ...allocationPredicates(sql, sql`f.allocation_id`, filter),
      ])}
    ), records AS (
      SELECT posting_id, part, counted_on, sum(amount_minor) AS amount, sum(counted) AS counted
      FROM scoped GROUP BY posting_id, part, counted_on
    )`;
  const predicates = postingPredicates(sql, filter);
  const listed = [...predicates];
  if (cursor)
    listed.push(
      sql`(r.part > ${cursor.part}::int OR (r.part = ${cursor.part}::int AND (r.counted_on, p.id) < (${cursor.on}::date, ${cursor.id}::uuid)))`,
    );
  const rows =
    yield* sql`${records} SELECT ${ledgerRowColumns(sql)}, r.part, r.counted_on::text AS "on",
        jsonb_build_object('currency', ${currency}::text, 'minor', r.counted::text) AS counted
      FROM records r JOIN postings p ON p.id = r.posting_id JOIN accounts a ON a.id = p.account_id
      ${ledgerMeaning(sql)}
      WHERE ${sql.and(listed)}
      ORDER BY r.part, r.counted_on DESC, p.id DESC LIMIT ${pageSize + 1}`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(CountedLedgerRow))),
    );
  const totals =
    yield* sql`${records} SELECT r.part, sum(r.amount)::text AS amount, count(DISTINCT r.posting_id)::int AS postings
      FROM records r JOIN postings p ON p.id = r.posting_id
      WHERE ${sql.and(predicates)} GROUP BY r.part`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(PartTotal))),
    );
  const partTotal = (index: number) => totals.find((row) => row.part === index);
  const money = (minor: bigint) => ({ currency, minor });
  const shown = rows.slice(0, pageSize);
  const last = shown.at(-1);
  return {
    scope,
    label: path.at(-1)?.label ?? measures[scope.measure].label,
    path,
    period: resolved.period,
    basis,
    currency,
    calculatedAt: resolved.calculatedAt,
    total: money(measureTotal(scope.measure, (_, index) => partTotal(index)?.amount ?? 0n)),
    parts: parts.map((part, index) => ({
      label: part.label,
      sign: part.sign,
      amount: money(partTotal(index)?.amount ?? 0n),
      postings: partTotal(index)?.postings ?? 0,
    })),
    rows: shown,
    nextCursor:
      rows.length > pageSize && last ? { part: last.part, on: last.on, id: last.id } : null,
  } satisfies typeof CountedLedgerPage.Type;
});

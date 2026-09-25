import { PgClient } from "@effect/sql-pg";
import {
  CalendarDate,
  type CreditLink,
  type EventId,
  type FinancialEvent,
  type MeasureImpact,
  type PeriodMeasures,
} from "@repo/contracts/finance";
import { monthsPeriod, yearMonthOf, type LedgerFact } from "@repo/finance";
import { Data, DateTime, Effect, Schema } from "effect";

import type { WriteFailure } from "../database/commands.ts";
import { writeTransaction } from "../database/transactions.ts";
import { readEvents } from "../events/repository.ts";
import { deriveFacts, readNotedEvents, refreshNotedFacts, writeFacts } from "./facts.ts";
import { summarizePeriod } from "./flows.ts";

// Carries a preview's result out of the transaction it rolls back.
class Discard<A> extends Data.TaggedError("Discard")<{ readonly value: A }> {}

type Month = { currency: string; on: CalendarDate };

const measure = Effect.fn("measure")(function* (month: Month) {
  const period = monthsPeriod(yearMonthOf(month.on));
  const flow = yield* summarizePeriod({
    currency: month.currency,
    basis: "spending",
    period,
    comparison: period,
  });
  const money = (minor: bigint) => ({ currency: month.currency, minor });
  const stream = (key: string) =>
    [...flow.inflows, ...flow.outflows].find((row) => row.key === key)?.amount ?? money(0n);
  return {
    ...flow.totals,
    loanPrincipal: stream("loanPrincipal"),
    unresolvedOut: stream("unresolvedOut"),
    unresolvedIn: stream("unresolvedIn"),
    modelShare: flow.modelShare,
  } satisfies typeof PeriodMeasures.Type;
});

// The months, by spending date, of these events' stored facts and of `facts`.
const monthsOf = Effect.fn("monthsOf")(function* (
  eventIds: readonly (typeof EventId.Type)[],
  facts: readonly LedgerFact[],
) {
  const sql = yield* PgClient.PgClient;
  const stored =
    eventIds.length === 0
      ? []
      : yield* sql`SELECT DISTINCT currency, spending_on::text AS on FROM ledger_facts WHERE event_id = ANY(${eventIds}::uuid[])`.pipe(
          Effect.flatMap(
            Schema.decodeUnknownEffect(
              Schema.Array(Schema.Struct({ currency: Schema.String, on: CalendarDate })),
            ),
          ),
        );
  return [
    ...new Map(
      [...stored, ...facts.map((fact) => ({ currency: fact.currency, on: fact.spendingOn }))].map(
        (month) => [`${month.currency}:${yearMonthOf(month.on)}`, month],
      ),
    ).values(),
  ].toSorted((a, b) => a.on.localeCompare(b.on) || a.currency.localeCompare(b.currency));
});

// Summarises each month the way the overview does, before and after `change` writes
// facts in the current transaction.
const measureAround = Effect.fn("measureAround")(function* <A, E, R>(
  months: readonly Month[],
  change: Effect.Effect<A, E, R>,
) {
  const before = yield* Effect.forEach(months, measure);
  yield* change;
  const after = yield* Effect.forEach(months, measure);
  const calculatedAt = DateTime.formatIso(yield* DateTime.now);
  return months.flatMap((month, index): (typeof MeasureImpact.Type)[] => {
    const beforeMonth = before[index];
    const afterMonth = after[index];
    return beforeMonth && afterMonth
      ? [
          {
            ...monthsPeriod(yearMonthOf(month.on)),
            basis: "spending",
            currency: month.currency,
            calculatedAt,
            before: beforeMonth,
            after: afterMonth,
          },
        ]
      : [];
  });
});

// What a change does to every month its facts touch: the change's facts are written in
// a savepoint, each month is summarised from stored facts before and after, and the
// savepoint is rolled back. `after` holds the events as the change leaves them, and
// `links` every credit link before and after it when the change adds or removes one.
export const previewImpacts = Effect.fn("previewImpacts")(function* ({
  before,
  after,
  links,
}: {
  before: readonly FinancialEvent[];
  after: readonly FinancialEvent[];
  links?: {
    readonly before: readonly (typeof CreditLink.Type)[];
    readonly after: readonly (typeof CreditLink.Type)[];
  };
}) {
  const sql = yield* PgClient.PgClient;
  const affected = [
    ...new Set([
      ...before.map((event) => event.id),
      ...after.map((event) => event.id),
      ...(links ? [...links.before, ...links.after] : [])
        .filter(
          (link) =>
            !links?.before.some((item) => item.id === link.id) ||
            !links.after.some((item) => item.id === link.id),
        )
        .flatMap((link) => [link.creditEventId, link.costEventId]),
    ]),
  ];
  if (affected.length === 0) return [];
  const changed = new Set<string>(after.map((event) => event.id));
  const unchanged = yield* readEvents(affected.filter((id) => !changed.has(id)));
  const facts = yield* deriveFacts([...after, ...unchanged], links?.after);
  const months = yield* monthsOf(affected, facts);
  return yield* sql
    .withTransaction(
      Effect.gen(function* () {
        return yield* new Discard({
          value: yield* measureAround(months, writeFacts(affected, facts)),
        });
      }),
    )
    .pipe(Effect.catchTag("Discard", (discarded) => Effect.succeed(discarded.value)));
});

// Runs `write` for real inside a write transaction, measures every month whose facts it
// changes, and rolls it back. `eventCount` counts the transactions it changed, which a
// change of category alone changes without moving any total.
export const previewWrite = Effect.fn("previewWrite")(function* <A, R>(
  write: Effect.Effect<A, WriteFailure, R>,
) {
  const sql = yield* PgClient.PgClient;
  return yield* writeTransaction(
    sql,
    Effect.gen(function* () {
      const result = yield* write;
      const noted = yield* readNotedEvents;
      const months = yield* monthsOf(noted, yield* deriveFacts(yield* readEvents(noted)));
      return yield* new Discard({
        value: {
          result,
          eventCount: noted.length,
          impacts: yield* measureAround(months, refreshNotedFacts),
        },
      });
    }),
  ).pipe(Effect.catchTag("Discard", (discarded) => Effect.succeed(discarded.value)));
});

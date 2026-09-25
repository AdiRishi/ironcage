import { PgClient } from "@effect/sql-pg";
import {
  CalendarDate,
  type CreditLink,
  type FinancialEvent,
  type MeasureImpact,
  type PeriodMeasures,
} from "@repo/contracts/finance";
import { monthsPeriod, yearMonthOf } from "@repo/finance";
import { Data, DateTime, Effect, Schema } from "effect";

import { readEvents } from "../events/repository.ts";
import { deriveFacts, writeFacts } from "./facts.ts";
import { summarizePeriod } from "./flows.ts";

class Discard extends Data.TaggedError("Discard")<{
  readonly measures: readonly (typeof PeriodMeasures.Type)[];
}> {}

const measure = Effect.fn("measure")(function* (month: { currency: string; on: CalendarDate }) {
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

// What a change does to every month its facts touch, computed the way the screens
// compute it: the change's facts are written in a savepoint, each month is summarised
// from stored facts before and after, and the savepoint is rolled back. `after` holds
// the events as the change leaves them, and `links` every credit link before and after
// it when the change adds or removes one.
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
  const stored =
    yield* sql`SELECT DISTINCT currency, spending_on::text AS on FROM ledger_facts WHERE event_id = ANY(${affected}::uuid[])`.pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(
          Schema.Array(Schema.Struct({ currency: Schema.String, on: CalendarDate })),
        ),
      ),
    );
  const months = [
    ...new Map(
      [...stored, ...facts.map((fact) => ({ currency: fact.currency, on: fact.spendingOn }))].map(
        (month) => [`${month.currency}:${yearMonthOf(month.on)}`, month],
      ),
    ).values(),
  ].toSorted((a, b) => a.on.localeCompare(b.on) || a.currency.localeCompare(b.currency));
  const beforeMeasures = yield* Effect.forEach(months, measure);
  const afterMeasures = yield* sql
    .withTransaction(
      Effect.gen(function* () {
        yield* writeFacts(affected, facts);
        return yield* new Discard({ measures: yield* Effect.forEach(months, measure) });
      }),
    )
    .pipe(Effect.catchTag("Discard", (discarded) => Effect.succeed(discarded.measures)));
  const calculatedAt = DateTime.formatIso(yield* DateTime.now);
  return months.flatMap((month, index): (typeof MeasureImpact.Type)[] => {
    const beforeMonth = beforeMeasures[index];
    const afterMonth = afterMeasures[index];
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

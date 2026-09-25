import { PgClient } from "@effect/sql-pg";
import { CalendarDate, CommandId, type FlowInput, YearMonth } from "@repo/contracts/finance";
import { Crypto, DateTime, Effect } from "effect";
import { TestClock } from "effect/testing";
import { expect } from "vitest";

import { Flows } from "../../src/analysis/flows.ts";
import { Corrections } from "../../src/events/corrections.ts";
import { Events } from "../../src/events/service.ts";
import { Publication } from "../../src/imports/publication.ts";
import { Counterparties } from "../../src/interpretation/counterparties.ts";
import { Postings } from "../../src/postings/service.ts";
import { applicationTest } from "../support/application.ts";
import { account, parsedRows, reset, source } from "../support/fixtures.ts";

const { test, services } = applicationTest();
const commandId = Crypto.Crypto.use((crypto) => crypto.randomUUIDv4).pipe(
  Effect.map((id) => CommandId.make(id)),
);
const august: FlowInput = {
  period: { kind: "months", from: YearMonth.make("2026-08"), to: YearMonth.make("2026-08") },
  comparison: { kind: "previous" },
  basis: "posted",
  currency: "AUD",
};

const setup = Effect.fn("flowSetup")(function* (earlier: Parameters<typeof parsedRows>[0] = []) {
  yield* reset;
  const owner = yield* account();
  const sql = yield* PgClient.PgClient;
  yield* sql`UPDATE accounts SET account_number = '06200011112222' WHERE id = ${owner.id}`;
  const file = yield* source(owner.id);
  yield* (yield* Publication).publish({
    ...parsedRows([
      ...earlier,
      { description: "Salary ACME PTY LTD HR123", postedOn: "2026-08-01", minor: 850000n },
      { description: "UBER EATS Card xx1234", postedOn: "2026-07-10", minor: -2000n },
      { description: "UBER EATS Card xx1234", postedOn: "2026-08-10", minor: -2500n },
      { description: "UBER EATS Card xx1234", postedOn: "2026-08-12", minor: -2500n },
      {
        description: "Transfer To Jane Smith NetBank Rent",
        postedOn: "2026-08-03",
        minor: -184000n,
      },
      { description: "Transfer to xx2222 CommBank app", postedOn: "2026-08-04", minor: -50000n },
    ]),
    importId: file.importId,
  });
  const events = yield* Events;
  const categories = (yield* events.references).categories;
  const category = (slug: string) => {
    const found = categories.find((row) => row.slug === slug);
    if (!found) throw new Error(`Expected ${slug}`);
    return found.id;
  };
  const counterparties = yield* Counterparties;
  yield* counterparties.save({
    commandId: yield* commandId,
    target: { kind: "create", aliasKeys: ["UBER EATS"] },
    fields: {
      name: "Uber Eats",
      kind: "business",
      brand: null,
      defaultCategoryId: category("food.delivery"),
      defaultRole: null,
    },
  });
  return { events, category, counterparties };
});

test(
  "the flow counts a payment to a person as spending once it is answered, and never counts own-account moves",
  Effect.gen(function* () {
    const { category, counterparties } = yield* setup();
    const flows = yield* Flows;
    const before = yield* flows.period(august);
    expect(before.totals).toMatchObject({
      inflow: { minor: 850000n },
      spending: { minor: 5000n },
      outflow: { minor: 189000n },
      internal: { minor: 50000n },
    });
    expect(before.outflows.find((stream) => stream.kind === "unresolvedOut")?.amount.minor).toBe(
      184000n,
    );
    yield* counterparties.save({
      commandId: yield* commandId,
      target: { kind: "create", aliasKeys: ["JANE SMITH"] },
      fields: {
        name: "Jane Smith",
        kind: "person",
        brand: null,
        defaultCategoryId: category("housing.rent"),
        defaultRole: "purchase",
      },
    });
    const after = yield* flows.period(august);
    expect(after.totals.spending.minor).toBe(189000n);
    expect(after.outflows.map((stream) => [stream.label, stream.amount.minor])).toEqual([
      ["Housing", 184000n],
      ["Food", 5000n],
    ]);
    expect(after.changes[0]).toMatchObject({ label: "Rent", parentLabel: "Housing" });
    const delivery = after.changes.find((change) => change.label === "Delivery");
    expect(delivery).toMatchObject({ purchases: 2, previousPurchases: 1 });
    expect(delivery?.purchasesPart?.minor).toBe(2250n);
    expect(delivery?.averagePart?.minor).toBe(750n);
  }).pipe(Effect.provide(services)),
);

test(
  "ledger facts follow a correction made after the counterparty default",
  Effect.gen(function* () {
    const { events, category } = yield* setup();
    const [posting] = (yield* (yield* Postings).list({ filter: { description: "UBER EATS" } }))
      .rows;
    if (!posting) return yield* Effect.die("Expected a delivery");
    const event = yield* events.forPosting({ postingId: posting.id });
    if (!event) return yield* Effect.die("Expected an event");
    yield* (yield* Corrections).apply({
      commandId: yield* commandId,
      expectedVersions: [{ eventId: event.id, version: event.version }],
      change: {
        eventId: event.id,
        kind: "purchase",
        purchaseOn: null,
        allocations: [{ ...event.allocations[0], categoryId: category("shopping.gifts") }],
      },
    });
    const spending = yield* (yield* Flows).spending({ ...august, categoryId: null });
    expect(spending.rows.map((row) => [row.label, row.current.minor])).toEqual([
      ["Food", 2500n],
      ["Shopping", 2500n],
    ]);
    const food = yield* (yield* Flows).spending({ ...august, categoryId: category("food") });
    expect(food.path.map((row) => row.label)).toEqual(["Food"]);
    expect(food.rows[0]).toMatchObject({ label: "Delivery", purchases: 1, previousPurchases: 1 });
    expect(food.counterparties[0]).toMatchObject({ label: "Uber Eats" });
  }).pipe(Effect.provide(services)),
);

test(
  "the monthly series runs from the first record to today with its spending",
  Effect.gen(function* () {
    yield* setup();
    const months = yield* (yield* Flows).monthly({ currency: "AUD" });
    expect(months[0]).toMatchObject({ month: "2026-07", spending: { minor: 2000n } });
    expect(months.find((row) => row.month === "2026-08")?.spending.minor).toBe(5000n);
  }).pipe(Effect.provide(services)),
);

test(
  "a month compares with the same month a year earlier or with chosen dates",
  Effect.gen(function* () {
    yield* setup([
      { description: "UBER EATS Card xx1234", postedOn: "2025-08-01", minor: -1200n },
      { description: "UBER EATS Card xx1234", postedOn: "2025-08-21", minor: -3300n },
    ]);
    const flows = yield* Flows;
    const yearBefore = yield* flows.period({ ...august, comparison: { kind: "previousYear" } });
    expect(yearBefore.comparison).toEqual({ start: "2025-08-01", endExclusive: "2025-09-01" });
    expect(yearBefore.previousTotals.spending.minor).toBe(4500n);
    const chosen = {
      kind: "fixed",
      start: CalendarDate.make("2026-07-01"),
      endExclusive: CalendarDate.make("2026-08-01"),
    } as const;
    expect(
      (yield* flows.period({ ...august, comparison: chosen })).previousTotals.spending.minor,
    ).toBe(2000n);
    const spendingYearBefore = yield* flows.spending({
      ...august,
      comparison: { kind: "previousYear" },
      categoryId: null,
    });
    expect(
      spendingYearBefore.rows.map((row) => [row.label, row.previous.minor, row.previousPurchases]),
    ).toEqual([["Food", 4500n, 2]]);
    const spendingChosen = yield* flows.spending({
      ...august,
      comparison: chosen,
      categoryId: null,
    });
    expect(
      spendingChosen.rows.map((row) => [row.label, row.previous.minor, row.previousPurchases]),
    ).toEqual([["Food", 2000n, 1]]);
  }).pipe(Effect.provide(services)),
);

test(
  "a comparison before the first record is reported missing rather than as no spending",
  Effect.gen(function* () {
    yield* setup();
    const flows = yield* Flows;
    const beforeRecords = {
      ...august,
      comparison: {
        kind: "fixed",
        start: CalendarDate.make("2024-08-01"),
        endExclusive: CalendarDate.make("2024-09-01"),
      },
    } as const;
    const missing = {
      state: "missing",
      gaps: [
        {
          account: { label: "Everyday" },
          missing: [{ start: "2024-08-01", endExclusive: "2024-09-01" }],
        },
      ],
    };
    expect((yield* flows.period(beforeRecords)).comparisonCoverage).toMatchObject(missing);
    expect(
      (yield* flows.spending({ ...beforeRecords, categoryId: null })).comparisonCoverage,
    ).toMatchObject(missing);
  }).pipe(Effect.provide(services)),
);

test(
  "a month in progress ends after today in the settings timezone, not in UTC",
  Effect.gen(function* () {
    yield* setup();
    const flows = yield* Flows;
    // 08:00 on 1 September in Sydney is still 31 August in UTC.
    const sydneyMorning = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe("2026-08-31T22:00:00Z"))).pipe(
        Effect.andThen(effect),
        Effect.provide(TestClock.layer()),
      );
    const september = yield* sydneyMorning(
      flows.period({
        ...august,
        period: { kind: "months", from: YearMonth.make("2026-09"), to: YearMonth.make("2026-09") },
      }),
    );
    expect(september.period).toEqual({ start: "2026-09-01", endExclusive: "2026-09-02" });
    expect(september.comparison).toEqual({ start: "2026-08-01", endExclusive: "2026-08-02" });
    const months = yield* sydneyMorning(flows.monthly({ currency: "AUD" }));
    expect(months.at(-1)?.month).toBe("2026-09");
  }).pipe(Effect.provide(services)),
);

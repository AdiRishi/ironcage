import {
  CalendarDate,
  CommandId,
  type ListQuestions,
  type PeriodSelection,
  type Rule,
  type RuleAction,
  RuleId,
} from "@repo/contracts/finance";
import { Crypto, Effect } from "effect";
import { expect } from "vitest";

import { Flows } from "../../src/analysis/flows.ts";
import { Corrections } from "../../src/events/corrections.ts";
import { Publication } from "../../src/imports/publication.ts";
import { Counterparties } from "../../src/interpretation/counterparties.ts";
import { CounterpartyHistory } from "../../src/interpretation/counterparty-history.ts";
import { Questions } from "../../src/interpretation/questions.ts";
import { Rules } from "../../src/rules/service.ts";
import { applicationTest } from "../support/application.ts";
import {
  account,
  createCounterparty,
  enrich,
  openQuestions,
  parsedRows,
  reset,
  source,
} from "../support/fixtures.ts";
import { activeEvent, categoryId, counterpartyNamed } from "../support/populated.ts";

const { test, services } = applicationTest();
const uuid = Crypto.Crypto.use((crypto) => crypto.randomUUIDv4);
const commandId = uuid.pipe(Effect.map((id) => CommandId.make(id)));
const fixed = (start: string, endExclusive: string) =>
  ({
    kind: "fixed",
    start: CalendarDate.make(start),
    endExclusive: CalendarDate.make(endExclusive),
  }) satisfies PeriodSelection;
const july = fixed("2026-07-01", "2026-08-01");
const august = fixed("2026-08-01", "2026-09-01");

const publish = Effect.fn(function* (rows: Parameters<typeof parsedRows>[0]) {
  yield* reset;
  const owner = yield* account();
  const file = yield* source(owner.id);
  yield* (yield* Publication).publish({ ...parsedRows(rows), importId: file.importId });
});

const list = Effect.fn(function* (input: Partial<typeof ListQuestions.Type>) {
  return yield* (yield* Questions).list({
    currency: "AUD",
    filter: null,
    period: null,
    cursor: null,
    ...input,
  });
});

// Corrects a transaction to a purchase in the category with this slug.
const setByHand = Effect.fn(function* (description: string, slug: string) {
  const event = yield* activeEvent(description);
  yield* (yield* Corrections).apply({
    commandId: yield* commandId,
    expectedVersions: [{ eventId: event.id, version: event.version }],
    change: {
      eventId: event.id,
      kind: "purchase",
      purchaseOn: null,
      allocations: [
        { ...event.allocations[0], role: "purchase", categoryId: yield* categoryId(slug) },
      ],
    },
  });
});

// Saves a rule over every transaction, past and future, whose description has this text.
const saveRule = Effect.fn(function* (
  name: string,
  description: string,
  action: typeof RuleAction.Type,
) {
  const rules = yield* Rules;
  const rule: Rule = {
    id: RuleId.make(yield* uuid),
    name,
    conditions: { accountId: null, role: null, counterpartyId: null, channel: null, description },
    action,
    scope: "both",
    version: 1,
  };
  const preview = yield* rules.preview({ rule, exceptionEventIds: [] });
  yield* rules.save({
    commandId: yield* commandId,
    rule,
    exceptionEventIds: [],
    expectedVersion: null,
    expectedVersions: preview.expectedVersions,
  });
  return rule;
});
const setsCategory = Effect.fn(function* (slug: string) {
  return { kind: "category", categoryId: yield* categoryId(slug) } satisfies typeof RuleAction.Type;
});

test(
  "a model-proposed person answered for one reference counts that reference as spending and still asks about the other",
  Effect.gen(function* () {
    yield* publish([
      {
        description: "Transfer To Jane Smith NetBank Rent Aug",
        postedOn: "2026-08-01",
        minor: -184000n,
      },
      {
        description: "Transfer To Jane Smith NetBank Rent Sept",
        postedOn: "2026-09-01",
        minor: -184000n,
      },
      {
        description: "Transfer To Jane Smith NetBank dinner split",
        postedOn: "2026-09-05",
        minor: -4000n,
      },
    ]);
    yield* enrich([
      {
        aliasKey: "JANE SMITH",
        name: "Jane Smith",
        kind: "person",
        defaultRole: "reimbursement",
        categoryKey: "food.dining-out",
        confidence: 0.7,
      },
    ]);
    const asked = Effect.map(openQuestions, (rows) =>
      rows.map((row) => [row.kind, row.kind === "person" ? row.reference?.key : null]),
    );
    expect(yield* asked).toEqual([
      ["person", "rent"],
      ["person", "dinner split"],
    ]);

    const jane = yield* counterpartyNamed("Jane Smith");
    const { changeId } = yield* (yield* Counterparties).apply({
      commandId: yield* commandId,
      change: {
        kind: "saveReference",
        counterpartyId: jane.id,
        referenceKey: "rent",
        expectedVersion: null,
        defaultRole: "purchase",
        defaultCategoryId: yield* categoryId("housing.rent"),
      },
    });
    expect(yield* counterpartyNamed("Jane Smith")).toMatchObject({
      source: "user",
      status: "applied",
      defaultRole: null,
      defaultCategoryId: null,
    });
    expect(yield* asked).toEqual([["person", "dinner split"]]);
    const flow = yield* (yield* Flows).period({
      period: fixed("2026-08-01", "2026-10-01"),
      comparison: { kind: "previous" },
      basis: "spending",
      currency: "AUD",
    });
    expect(flow.totals.spending.minor).toBe(368000n);
    expect(flow.modelShare.minor).toBe(0n);

    if (!changeId) return yield* Effect.die("Expected a recorded change");
    yield* (yield* CounterpartyHistory).undo({ commandId: yield* commandId, changeId });
    expect(yield* counterpartyNamed("Jane Smith")).toMatchObject({
      source: "model",
      status: "proposed",
      defaultRole: "reimbursement",
    });
    expect(yield* asked).toEqual([
      ["person", "rent"],
      ["person", "dinner split"],
    ]);
  }).pipe(Effect.provide(services)),
);

test(
  "a person question proposes your answer for the same reference elsewhere, else the category it names, else the model's role",
  Effect.gen(function* () {
    yield* publish([
      {
        description: "Transfer To Jane Smith NetBank Rent Aug",
        postedOn: "2026-08-01",
        minor: -184000n,
      },
      {
        description: "Transfer To Jane Smith NetBank dinner split",
        postedOn: "2026-08-05",
        minor: -4000n,
      },
      {
        description: "Transfer To Alex Wu NetBank Rent Aug",
        postedOn: "2026-08-01",
        minor: -150000n,
      },
    ]);
    yield* enrich([
      {
        aliasKey: "JANE SMITH",
        name: "Jane Smith",
        kind: "person",
        defaultRole: "reimbursement",
        categoryKey: "food.dining-out",
        confidence: 0.7,
        reason: "Split bills between friends.",
      },
    ]);
    const rent = yield* categoryId("housing.rent");
    const proposals = Effect.map(openQuestions, (rows) =>
      rows.flatMap((row) =>
        row.kind === "person"
          ? [[row.counterparty.name, row.reference?.key, row.proposal] as const]
          : [],
      ),
    );
    expect(yield* proposals).toEqual([
      ["Jane Smith", "rent", { role: "purchase", categoryId: rent, basis: { kind: "reference" } }],
      [
        "Jane Smith",
        "dinner split",
        {
          role: "purchase",
          categoryId: yield* categoryId("food.dining-out"),
          basis: { kind: "model", confidence: 0.7, reason: "Split bills between friends." },
        },
      ],
    ]);

    const alex = yield* createCounterparty({ name: "Alex Wu", kind: "person" }, ["ALEX WU"]);
    yield* (yield* Counterparties).apply({
      commandId: yield* commandId,
      change: {
        kind: "saveReference",
        counterpartyId: alex.id,
        referenceKey: "rent",
        expectedVersion: null,
        defaultRole: "purchase",
        defaultCategoryId: yield* categoryId("housing"),
      },
    });
    expect((yield* proposals)[0]).toEqual([
      "Jane Smith",
      "rent",
      {
        role: "purchase",
        categoryId: yield* categoryId("housing"),
        basis: { kind: "answer", counterpartyId: alex.id, counterpartyName: "Alex Wu" },
      },
    ]);
  }).pipe(Effect.provide(services)),
);

test(
  "a person question closes when every payment is set by hand, and hand-set payments are not money it affects",
  Effect.gen(function* () {
    yield* publish([
      {
        description: "Transfer To Sam Lee NetBank gift Aug",
        postedOn: "2026-08-02",
        minor: -5000n,
      },
      {
        description: "Transfer To Sam Lee NetBank gift Sept",
        postedOn: "2026-09-02",
        minor: -7000n,
      },
    ]);
    yield* createCounterparty({ name: "Sam Lee", kind: "person" }, ["SAM LEE"]);
    yield* setByHand("Transfer To Sam Lee NetBank gift Aug", "shopping.gifts");
    expect(yield* openQuestions).toMatchObject([
      {
        kind: "person",
        affects: {
          eventCount: 1,
          outflow: { minor: 7000n },
          firstOn: "2026-09-02",
          lastOn: "2026-09-02",
        },
      },
    ]);
    yield* setByHand("Transfer To Sam Lee NetBank gift Sept", "shopping.gifts");
    expect(yield* openQuestions).toEqual([]);
  }).pipe(Effect.provide(services)),
);

test(
  "the period figure counts questions and money by spending date",
  Effect.gen(function* () {
    yield* publish([
      { description: "Transfer To Pat Kim NetBank", postedOn: "2026-07-15", minor: -4000n },
      { description: "Transfer To Pat Kim NetBank lunch", postedOn: "2026-08-10", minor: -9000n },
      { description: "SQ *NEW CAFE 0412 Card xx1234", postedOn: "2026-08-02", minor: -2500n },
    ]);
    yield* enrich([{ aliasKey: "SQ NEW CAFE", name: "New Cafe", confidence: 0.4 }]);
    const cafe = yield* activeEvent("SQ *NEW CAFE 0412 Card xx1234");
    yield* (yield* Corrections).apply({
      commandId: yield* commandId,
      expectedVersions: [{ eventId: cafe.id, version: cafe.version }],
      change: {
        eventId: cafe.id,
        kind: "purchase",
        purchaseOn: CalendarDate.make("2026-07-31"),
        allocations: cafe.allocations,
      },
    });
    const questions = yield* Questions;

    expect(yield* questions.summary({ currency: "AUD", period: august })).toEqual({
      period: { start: "2026-08-01", endExclusive: "2026-09-01" },
      count: 1,
      byFilter: { who: 1, people: 0, accounts: 0, rules: 0 },
      outflow: { currency: "AUD", minor: 9000n },
      inflow: { currency: "AUD", minor: 0n },
    });
    expect(yield* questions.summary({ currency: "AUD", period: july })).toMatchObject({
      count: 2,
      byFilter: { who: 2 },
      outflow: { minor: 6500n },
    });
    expect((yield* list({ period: july })).rows).toMatchObject([
      {
        kind: "unresolved",
        affects: { eventCount: 2, outflow: { minor: 13000n } },
        affectsInPeriod: { eventCount: 1, outflow: { minor: 4000n } },
      },
      { kind: "counterparty", affectsInPeriod: { eventCount: 1, outflow: { minor: 2500n } } },
    ]);
  }).pipe(Effect.provide(services)),
);

test(
  "a list narrowed to a period ranks questions by their money in it and shows those transactions first",
  Effect.gen(function* () {
    yield* publish([
      { description: "Transfer To Pat Kim NetBank", postedOn: "2026-08-12", minor: -50000n },
      { description: "Transfer To Pat Kim NetBank", postedOn: "2026-07-20", minor: -1000n },
      { description: "Transfer To Lee Wong NetBank", postedOn: "2026-07-08", minor: -4000n },
    ]);
    const firstSamples = Effect.map(list({ period: july }), ({ rows }) =>
      rows.map((row) => [row.samples[0].description, row.samples[0].postedOn]),
    );

    expect(yield* firstSamples).toEqual([
      ["Transfer To Lee Wong NetBank", "2026-07-08"],
      ["Transfer To Pat Kim NetBank", "2026-07-20"],
    ]);
    expect((yield* list({})).rows.map((row) => row.samples[0].description)).toEqual([
      "Transfer To Pat Kim NetBank",
      "Transfer To Lee Wong NetBank",
    ]);
  }).pipe(Effect.provide(services)),
);

test(
  "the money questions affect counts a transaction behind two questions once",
  Effect.gen(function* () {
    yield* publish([
      { description: "Transfer To Sam Lee NetBank gift", postedOn: "2026-08-04", minor: -15000n },
    ]);
    yield* createCounterparty({ name: "Sam Lee", kind: "person" }, ["SAM LEE"]);
    yield* saveRule("Gifts", "Sam Lee", yield* setsCategory("shopping.gifts"));
    yield* saveRule("Household", "Sam Lee", yield* setsCategory("shopping.home"));

    expect(yield* (yield* Questions).summary({ currency: "AUD", period: null })).toMatchObject({
      count: 2,
      byFilter: { who: 0, people: 1, accounts: 0, rules: 1 },
      outflow: { minor: 15000n },
    });
  }).pipe(Effect.provide(services)),
);

test(
  "counts and pages are not capped by what one page shows",
  Effect.gen(function* () {
    const name = (index: number) =>
      `Payee ${String.fromCodePoint(65 + Math.floor(index / 26))}${String.fromCodePoint(97 + (index % 26))}`;
    yield* publish([
      ...Array.from({ length: 30 }, (_, index) => ({
        description: `Transfer To ${name(index)} NetBank`,
        postedOn: "2026-08-03",
        minor: -2000n,
      })),
      { description: "Transfer To Sam Lee NetBank gift", postedOn: "2026-08-04", minor: -500n },
    ]);
    yield* createCounterparty({ name: "Sam Lee", kind: "person" }, ["SAM LEE"]);
    const questions = yield* Questions;

    expect(yield* questions.summary({ currency: "AUD", period: null })).toMatchObject({
      period: null,
      count: 31,
      byFilter: { who: 30, people: 1, accounts: 0, rules: 0 },
      outflow: { minor: 60500n },
    });
    const first = yield* list({ filter: "who" });
    expect(first.rows).toHaveLength(25);
    expect(first.nextCursor).not.toBeNull();
    const second = yield* list({ filter: "who", cursor: first.nextCursor });
    expect(second.rows).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    const ids = [...first.rows, ...second.rows].map((row) => row.id);
    expect(new Set(ids).size).toBe(30);
    expect(ids).toEqual(ids.toSorted());
    expect((yield* list({ filter: "people" })).rows).toMatchObject([
      { kind: "person", counterparty: { name: "Sam Lee" } },
    ]);
  }).pipe(Effect.provide(services)),
);

test(
  "a rule conflict names both rules and closes after a correction",
  Effect.gen(function* () {
    yield* publish([
      { description: "Synthetic market Card xx1234", postedOn: "2026-08-03", minor: -15000n },
    ]);
    const groceries = yield* saveRule(
      "Market groceries",
      "Synthetic market",
      yield* setsCategory("food.groceries"),
    );
    const household = yield* saveRule(
      "Market household",
      "Synthetic market",
      yield* setsCategory("shopping.home"),
    );

    const market = yield* activeEvent("Synthetic market Card xx1234");
    expect(yield* openQuestions).toMatchObject([
      {
        kind: "ruleConflict",
        eventId: market.id,
        rules: [
          { id: groceries.id, name: "Market groceries", action: groceries.action },
          { id: household.id, name: "Market household", action: household.action },
        ],
      },
    ]);
    yield* setByHand("Synthetic market Card xx1234", "food.groceries");
    expect(yield* openQuestions).toEqual([]);
  }).pipe(Effect.provide(services)),
);

test(
  "a rule conflict closes when your correction keeps the value the transaction already has",
  Effect.gen(function* () {
    yield* publish([
      { description: "Synthetic market Card xx1234", postedOn: "2026-08-03", minor: -15000n },
    ]);
    yield* saveRule("Market spending", "Synthetic market", { kind: "role", role: "purchase" });
    yield* saveRule("Market savings", "Synthetic market", { kind: "role", role: "transfer" });
    const market = yield* activeEvent("Synthetic market Card xx1234");
    expect(market.kind).toBe("purchase");
    expect(yield* openQuestions).toMatchObject([{ kind: "ruleConflict", eventId: market.id }]);

    yield* (yield* Corrections).apply({
      commandId: yield* commandId,
      expectedVersions: [{ eventId: market.id, version: market.version }],
      change: {
        eventId: market.id,
        kind: market.kind,
        purchaseOn: market.purchaseOn,
        allocations: market.allocations,
      },
    });
    expect(yield* openQuestions).toEqual([]);
    expect(yield* activeEvent("Synthetic market Card xx1234")).toMatchObject({
      kind: "purchase",
      roleSource: "user",
    });
  }).pipe(Effect.provide(services)),
);

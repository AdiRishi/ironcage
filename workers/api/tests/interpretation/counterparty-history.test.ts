import {
  CalendarDate,
  CommandId,
  type CounterpartyChange,
  type CounterpartyId,
  type EnrichmentResult,
  type FinancialEvent,
  RuleId,
} from "@repo/contracts/finance";
import { Crypto, Effect, Struct } from "effect";
import { expect } from "vitest";

import { Accounts } from "../../src/accounts/service.ts";
import { Corrections } from "../../src/events/corrections.ts";
import { Events } from "../../src/events/service.ts";
import { Publication } from "../../src/imports/publication.ts";
import { Counterparties } from "../../src/interpretation/counterparties.ts";
import { CounterpartyHistory } from "../../src/interpretation/counterparty-history.ts";
import { Enrichment } from "../../src/interpretation/enrichment.ts";
import { Postings } from "../../src/postings/service.ts";
import { References } from "../../src/references/service.ts";
import { Relationships } from "../../src/relationships/service.ts";
import { Rules } from "../../src/rules/service.ts";
import { applicationTest } from "../support/application.ts";
import {
  account,
  createCounterparty,
  openQuestions,
  parsedRows,
  reset,
  source,
  updateCounterparty,
} from "../support/fixtures.ts";
import { activeEvent, categoryId } from "../support/populated.ts";

const { test, services } = applicationTest();
const commandId = Crypto.Crypto.use((crypto) => crypto.randomUUIDv4).pipe(
  Effect.map((id) => CommandId.make(id)),
);

const publish = Effect.fn(function* (
  rows: ReadonlyArray<{ description: string; postedOn: string; minor: bigint }>,
) {
  yield* reset;
  const owner = yield* account();
  const file = yield* source(owner.id);
  yield* (yield* Publication).publish({ ...parsedRows(rows), importId: file.importId });
});
const apply = Effect.fn(function* (change: CounterpartyChange) {
  return yield* (yield* Counterparties).apply({ commandId: yield* commandId, change });
});
// August's money out by counterparty, with the transactions behind each amount.
const augustOutflows = Counterparties.use((counterparties) =>
  counterparties.list({
    search: "",
    currency: "AUD",
    period: {
      start: CalendarDate.make("2026-08-01"),
      endExclusive: CalendarDate.make("2026-09-01"),
    },
    direction: "out",
  }),
).pipe(Effect.map((rows) => rows.map((row) => [row.name, row.outflow.minor, row.outflowEvents])));

const metro = "WOOLWORTHS METRO 77 SURRY HILLS Card xx1234";
// Coles holds the descriptor of a Woolworths Metro store by mistake.
const misidentified = Effect.gen(function* () {
  yield* publish([
    { description: "WOOLWORTHS 1234 SYDNEY AU Card xx1234", postedOn: "2026-08-04", minor: -4200n },
    { description: metro, postedOn: "2026-08-06", minor: -2500n },
    { description: "COLES 0456 NEWTOWN AU Card xx1234", postedOn: "2026-08-08", minor: -1800n },
  ]);
  const woolworths = yield* createCounterparty(
    { name: "Woolworths", defaultCategoryId: yield* categoryId("food.groceries") },
    ["WOOLWORTHS SYDNEY"],
  );
  const coles = yield* createCounterparty(
    { name: "Coles", defaultCategoryId: yield* categoryId("shopping.general") },
    ["COLES NEWTOWN", "WOOLWORTHS METRO SURRY HILLS"],
  );
  return { woolworths, coles };
});

test(
  "taking a descriptor from another counterparty moves its transactions to the taker's defaults, and undo returns them",
  Effect.gen(function* () {
    const { woolworths, coles } = yield* misidentified;
    expect(yield* augustOutflows).toEqual([
      ["Coles", 4300n, 2],
      ["Woolworths", 4200n, 1],
    ]);
    const [match] = yield* (yield* Counterparties).searchDescriptors({
      search: "metro",
      excludeCounterpartyId: woolworths.id,
    });
    expect(match?.alias).toMatchObject({ counterpartyId: coles.id, version: 1 });
    const take = {
      commandId: yield* commandId,
      change: {
        kind: "moveAlias",
        aliasKey: "WOOLWORTHS METRO SURRY HILLS",
        expectedVersion: match?.alias?.version ?? null,
        counterpartyId: woolworths.id,
        event: null,
      },
    } as const;
    const counterparties = yield* Counterparties;
    const taken = yield* counterparties.apply(take);
    expect(yield* counterparties.apply(take)).toEqual(taken);
    expect(yield* augustOutflows).toEqual([
      ["Woolworths", 6700n, 2],
      ["Coles", 1800n, 1],
    ]);
    expect(yield* activeEvent(metro)).toMatchObject({
      counterpartyId: woolworths.id,
      allocations: [
        { categoryId: yield* categoryId("food.groceries"), categorySource: "counterparty" },
      ],
    });

    const history = yield* CounterpartyHistory;
    const [change] = (yield* history.list({ counterpartyId: woolworths.id })).rows;
    expect(change).toMatchObject({
      id: taken.changeId,
      kind: "moveAlias",
      subjects: [
        { id: coles.id, name: "Coles" },
        { id: woolworths.id, name: "Woolworths" },
      ],
      descriptors: [
        {
          aliasKey: "WOOLWORTHS METRO SURRY HILLS",
          text: "WOOLWORTHS METRO 77 SURRY HILLS",
          otherTexts: 0,
        },
      ],
      eventCount: 1,
      undoable: true,
      undone: false,
    });
    expect((yield* history.list({ counterpartyId: coles.id })).rows[0]?.id).toBe(taken.changeId);
    if (!taken.changeId) return yield* Effect.die("Expected the take in history");

    const undoing = { commandId: yield* commandId, changeId: taken.changeId };
    const undo = yield* history.undo(undoing);
    expect(yield* history.undo(undoing)).toEqual(undo);
    expect(undo.removed).toEqual([]);
    expect(yield* augustOutflows).toEqual([
      ["Coles", 4300n, 2],
      ["Woolworths", 4200n, 1],
    ]);
    expect(yield* activeEvent(metro)).toMatchObject({
      counterpartyId: coles.id,
      allocations: [
        { categoryId: yield* categoryId("shopping.general"), categorySource: "counterparty" },
      ],
    });
    expect(
      (yield* history.list({ counterpartyId: woolworths.id })).rows.map((row) => [
        row.kind,
        row.undoes?.id ?? null,
        row.undoable,
        row.undone,
      ]),
    ).toEqual([
      ["undo", taken.changeId, true, false],
      ["moveAlias", null, false, true],
      ["create", null, true, false],
    ]);
    const creation = (yield* history.list({ counterpartyId: woolworths.id })).rows.at(-1);
    if (!creation) return yield* Effect.die("Expected Woolworths's creation in history");
    const reused = yield* history.undo({ ...undoing, changeId: creation.id }).pipe(Effect.flip);
    expect(reused.kind).toBe("conflict");
    expect((yield* activeEvent("WOOLWORTHS 1234 SYDNEY AU Card xx1234")).counterpartyId).toBe(
      woolworths.id,
    );
  }).pipe(Effect.provide(services)),
);

test(
  "a descriptor move sent with an old alias version fails with stale and changes nothing",
  Effect.gen(function* () {
    const { woolworths, coles } = yield* misidentified;
    const take = {
      commandId: yield* commandId,
      change: {
        kind: "moveAlias",
        aliasKey: "WOOLWORTHS METRO SURRY HILLS",
        expectedVersion: 1,
        counterpartyId: woolworths.id,
        event: null,
      },
    } as const;
    const counterparties = yield* Counterparties;
    yield* counterparties.apply(take);
    const back = yield* counterparties
      .apply({
        ...take,
        commandId: yield* commandId,
        change: { ...take.change, counterpartyId: coles.id },
      })
      .pipe(Effect.flip);
    expect(back.kind).toBe("stale");
    const reused = yield* counterparties
      .apply({ ...take, change: { ...take.change, counterpartyId: coles.id, expectedVersion: 2 } })
      .pipe(Effect.flip);
    expect(reused.kind).toBe("conflict");
    expect((yield* activeEvent(metro)).counterpartyId).toBe(woolworths.id);
    expect(
      (yield* (yield* CounterpartyHistory).list({ counterpartyId: coles.id })).rows,
    ).toHaveLength(2);
  }).pipe(Effect.provide(services)),
);

const metroAt = (store: number) => `WOOLWORTHS METRO ${store} SURRY HILLS Card xx1234`;
// Three Woolworths Metro purchases the bank writes the same way, and a newsagency you
// may move some of them to by hand.
const metroPurchases = Effect.fn(function* (holder: "Coles" | "Woolworths") {
  yield* publish([
    { description: "WOOLWORTHS 1234 SYDNEY AU Card xx1234", postedOn: "2026-08-04", minor: -4200n },
    { description: metroAt(77), postedOn: "2026-08-06", minor: -2500n },
    { description: metroAt(78), postedOn: "2026-08-13", minor: -1300n },
    { description: metroAt(79), postedOn: "2026-08-20", minor: -900n },
  ]);
  const groceries = yield* categoryId("food.groceries");
  const metroKey = "WOOLWORTHS METRO SURRY HILLS";
  const woolworths = yield* createCounterparty(
    { name: "Woolworths", defaultCategoryId: groceries },
    holder === "Woolworths" ? ["WOOLWORTHS SYDNEY", metroKey] : ["WOOLWORTHS SYDNEY"],
  );
  const coles = yield* createCounterparty(
    { name: "Coles", defaultCategoryId: yield* categoryId("shopping.general") },
    holder === "Coles" ? [metroKey] : [],
  );
  const newsagency = yield* createCounterparty({ name: "Surry Hills Newsagency" }, []);
  const corrections = yield* Corrections;
  const moveByHand = Effect.fn(function* (description: string) {
    const event = yield* activeEvent(description);
    return yield* corrections.assignCounterparty({
      commandId: yield* commandId,
      eventId: event.id,
      counterpartyId: newsagency.id,
      expectedVersions: [{ eventId: event.id, version: event.version }],
    });
  });
  return { woolworths, coles, newsagency, groceries, moveByHand };
});
const assignments = Effect.forEach([77, 78, 79], (store) =>
  Effect.map(activeEvent(metroAt(store)), (event) => [
    event.counterpartyId,
    event.counterpartySource,
  ]),
);
// The descriptor-wide move chosen from one transaction, at the versions its page read.
const moveFrom = Effect.fn(function* (
  event: FinancialEvent,
  counterpartyId: typeof CounterpartyId.Type,
) {
  const detail = yield* (yield* Postings).get({ postingId: event.primaryPostingId });
  if (!detail.descriptor) return yield* Effect.die("Expected the Metro descriptor");
  return {
    descriptor: detail.descriptor,
    change: {
      kind: "moveAlias",
      aliasKey: detail.descriptor.aliasKey,
      expectedVersion: detail.descriptor.aliasVersion,
      counterpartyId,
      event: { eventId: event.id, version: event.version },
    } satisfies CounterpartyChange,
  };
});

test(
  "moving a descriptor from a transaction you moved by hand takes that transaction along, and undo puts it back",
  Effect.gen(function* () {
    const { woolworths, coles, newsagency, groceries, moveByHand } = yield* metroPurchases("Coles");
    const opened = yield* moveByHand(metroAt(77));
    yield* moveByHand(metroAt(79));
    const { descriptor, change } = yield* moveFrom(opened, woolworths.id);
    // This transaction and the one that follows the descriptor; not the other one moved
    // by hand.
    expect(descriptor.eventCount).toBe(2);
    const counterparties = yield* Counterparties;
    const preview = yield* counterparties.preview({ change });
    expect(preview.eventCount).toBe(2);
    expect(preview.event).toMatchObject({
      id: opened.id,
      counterpartyId: woolworths.id,
      allocations: [{ categoryId: groceries, categorySource: "counterparty" }],
    });
    expect(yield* assignments).toEqual([
      [newsagency.id, "user"],
      [coles.id, "alias"],
      [newsagency.id, "user"],
    ]);

    const moved = yield* counterparties.apply({ commandId: yield* commandId, change });
    expect(yield* assignments).toEqual([
      [woolworths.id, "alias"],
      [woolworths.id, "alias"],
      [newsagency.id, "user"],
    ]);
    if (!moved.changeId) return yield* Effect.die("Expected the move in history");
    yield* (yield* CounterpartyHistory).undo({
      commandId: yield* commandId,
      changeId: moved.changeId,
    });
    expect(yield* assignments).toEqual([
      [newsagency.id, "user"],
      [coles.id, "alias"],
      [newsagency.id, "user"],
    ]);
  }).pipe(Effect.provide(services)),
);

test(
  "history names a descriptor the bank prints several ways by one text and counts the others",
  Effect.gen(function* () {
    const { woolworths } = yield* metroPurchases("Coles");
    const { change } = yield* moveFrom(yield* activeEvent(metroAt(78)), woolworths.id);
    yield* (yield* Counterparties).apply({ commandId: yield* commandId, change });
    const [moved] = (yield* (yield* CounterpartyHistory).list({ counterpartyId: woolworths.id }))
      .rows;
    expect(moved?.descriptors).toEqual([
      {
        aliasKey: "WOOLWORTHS METRO SURRY HILLS",
        text: "WOOLWORTHS METRO 77 SURRY HILLS",
        otherTexts: 2,
      },
    ]);
  }).pipe(Effect.provide(services)),
);

test(
  "moving a descriptor to the counterparty that already holds it returns the transaction you moved by hand",
  Effect.gen(function* () {
    const { woolworths, newsagency, moveByHand } = yield* metroPurchases("Woolworths");
    const opened = yield* moveByHand(metroAt(77));
    const { change } = yield* moveFrom(opened, woolworths.id);
    const counterparties = yield* Counterparties;
    expect((yield* counterparties.preview({ change })).eventCount).toBe(1);
    const moved = yield* counterparties.apply({ commandId: yield* commandId, change });
    expect(moved.changeId).not.toBeNull();
    expect(yield* assignments).toEqual([
      [woolworths.id, "alias"],
      [woolworths.id, "alias"],
      [woolworths.id, "alias"],
    ]);
    expect(
      (yield* (yield* CounterpartyHistory).list({ counterpartyId: newsagency.id })).rows[0],
    ).toMatchObject({ id: moved.changeId, kind: "moveAlias", eventCount: 1 });
  }).pipe(Effect.provide(services)),
);

test(
  "a counterparty change sent at an older version of a record it writes fails with stale and records nothing",
  Effect.gen(function* () {
    yield* publish([
      { description: "COLES 0456 NEWTOWN AU Card xx1234", postedOn: "2026-08-08", minor: -1800n },
      {
        description: "Transfer To Jane Smith NetBank Rent",
        postedOn: "2026-08-01",
        minor: -184000n,
      },
    ]);
    const rent = yield* categoryId("housing.rent");
    const coles = yield* createCounterparty({ name: "Coles" }, ["COLES NEWTOWN"]);
    const jane = yield* createCounterparty(
      { name: "Jane Smith", kind: "person", defaultRole: "purchase" },
      ["JANE SMITH"],
    );
    const reference = {
      kind: "saveReference",
      counterpartyId: jane.id,
      referenceKey: "rent",
      expectedVersion: null,
      defaultRole: "purchase",
      defaultCategoryId: null,
    } as const;
    yield* apply(reference);
    yield* apply({ ...reference, expectedVersion: 1, defaultCategoryId: rent });
    const renamed = yield* updateCounterparty(coles, { name: "Coles Supermarkets" });
    const counterparties = yield* Counterparties;
    const history = yield* CounterpartyHistory;
    const state = Effect.gen(function* () {
      return {
        coles: yield* counterparties.get({ counterpartyId: coles.id }),
        jane: yield* counterparties.get({ counterpartyId: jane.id }),
        changes: [
          ...(yield* history.list({ counterpartyId: coles.id })).rows,
          ...(yield* history.list({ counterpartyId: jane.id })).rows,
        ].length,
      };
    });
    const before = yield* state;
    const stale = [
      { ...reference, expectedVersion: 1, defaultRole: "income" },
      {
        kind: "deleteReference",
        counterpartyId: jane.id,
        referenceKey: "rent",
        expectedVersion: 1,
      },
      {
        kind: "create",
        fields: {
          name: "Coles Newtown",
          kind: "business",
          brand: null,
          defaultCategoryId: null,
          defaultRole: null,
        },
        aliases: [{ aliasKey: "COLES NEWTOWN", expectedVersion: null }],
      },
      {
        kind: "update",
        counterpartyId: coles.id,
        expectedVersion: coles.version,
        fields: {
          ...Struct.pick(renamed, ["kind", "brand", "defaultCategoryId", "defaultRole"]),
          name: "Coles",
        },
      },
      {
        kind: "merge",
        sourceId: coles.id,
        sourceVersion: coles.version,
        targetId: jane.id,
        targetVersion: jane.version,
      },
      {
        kind: "merge",
        sourceId: jane.id,
        sourceVersion: jane.version,
        targetId: coles.id,
        targetVersion: coles.version,
      },
    ] satisfies CounterpartyChange[];
    for (const change of stale) {
      const failure = yield* counterparties
        .apply({ commandId: yield* commandId, change })
        .pipe(Effect.flip);
      expect([change.kind, failure.kind]).toEqual([change.kind, "stale"]);
    }
    expect(yield* state).toEqual(before);
    expect(before.jane.references).toMatchObject([
      { referenceKey: "rent", defaultRole: "purchase", defaultCategoryId: rent, version: 2 },
    ]);
  }).pipe(Effect.provide(services)),
);

test(
  "a merge keeps the target's own reference default and repoints the rule at a new version, and undoing it restores the source counterparty with the same ID, its descriptors, its reference default, the rule that named it, and the transaction assigned to it by hand",
  Effect.gen(function* () {
    yield* publish([
      {
        description: "Transfer To Jane Smith NetBank Rent",
        postedOn: "2026-08-01",
        minor: -184000n,
      },
      { description: "Transfer To J Smith NetBank Rent", postedOn: "2026-08-15", minor: -60000n },
      { description: "Transfer to xx9921 CommBank app", postedOn: "2026-08-20", minor: -5000n },
    ]);
    const rent = yield* categoryId("housing.rent");
    const jane = yield* createCounterparty(
      { name: "Jane Smith", kind: "person", defaultRole: "purchase", defaultCategoryId: rent },
      ["JANE SMITH"],
    );
    const duplicate = yield* createCounterparty(
      {
        name: "J Smith",
        kind: "person",
        defaultRole: "purchase",
        defaultCategoryId: yield* categoryId("giving.gifts-to-people"),
      },
      ["J SMITH"],
    );
    const rentDefault = {
      kind: "saveReference",
      counterpartyId: duplicate.id,
      referenceKey: "rent",
      expectedVersion: null,
      defaultRole: "purchase",
      defaultCategoryId: rent,
    } as const;
    yield* apply(rentDefault);
    const strata = yield* categoryId("housing.strata");
    yield* apply({ ...rentDefault, counterpartyId: jane.id, defaultCategoryId: strata });
    const janesRent = [
      { referenceKey: "rent", defaultRole: "purchase", defaultCategoryId: strata, version: 1 },
    ];
    const rule = {
      id: RuleId.make(yield* Crypto.Crypto.use((crypto) => crypto.randomUUIDv4)),
      name: "Gifts to J Smith",
      conditions: {
        accountId: null,
        role: null,
        counterpartyId: duplicate.id,
        channel: null,
        description: "Gift",
      },
      action: { kind: "category", categoryId: yield* categoryId("giving.gifts-to-people") },
      scope: "future",
      version: 1,
    } as const;
    const rules = yield* Rules;
    yield* rules.save({
      rule,
      exceptionEventIds: [],
      commandId: yield* commandId,
      expectedVersion: null,
      expectedVersions: (yield* rules.preview({ rule, exceptionEventIds: [] })).expectedVersions,
    });
    const transfer = yield* activeEvent("Transfer to xx9921 CommBank app");
    yield* (yield* Corrections).assignCounterparty({
      commandId: yield* commandId,
      eventId: transfer.id,
      counterpartyId: duplicate.id,
      expectedVersions: [{ eventId: transfer.id, version: transfer.version }],
    });
    // Rent at J Smith's rent default and the transfer at J Smith's own default.
    const before = [
      ["Jane Smith", 184000n, 1],
      ["J Smith", 65000n, 2],
    ];
    expect(yield* augustOutflows).toEqual(before);

    const counterparties = yield* Counterparties;
    const merged = yield* apply({
      kind: "merge",
      sourceId: duplicate.id,
      sourceVersion: duplicate.version,
      targetId: jane.id,
      targetVersion: jane.version,
    });
    expect(merged.counterparty.id).toBe(jane.id);
    expect(yield* augustOutflows).toEqual([["Jane Smith", 249000n, 3]]);
    expect(
      (yield* counterparties.get({ counterpartyId: duplicate.id }).pipe(Effect.flip)).kind,
    ).toBe("notFound");
    expect((yield* rules.list).find((row) => row.id === rule.id)).toMatchObject({
      conditions: { counterpartyId: jane.id },
      version: 2,
    });
    expect((yield* counterparties.get({ counterpartyId: jane.id })).references).toMatchObject(
      janesRent,
    );

    const history = yield* CounterpartyHistory;
    const [merge] = (yield* history.list({ counterpartyId: duplicate.id })).rows;
    expect(merge).toMatchObject({ id: merged.changeId, kind: "merge", undoable: true });
    if (!merge) return yield* Effect.die("Expected the merge in history");
    yield* history.undo({ commandId: yield* commandId, changeId: merge.id });

    expect(yield* augustOutflows).toEqual(before);
    const restored = yield* counterparties.get({ counterpartyId: duplicate.id });
    expect(restored.counterparty.name).toBe("J Smith");
    expect(restored.aliases.map((alias) => [alias.aliasKey, alias.source, alias.status])).toEqual([
      ["J SMITH", "user", "applied"],
    ]);
    expect(restored.references).toMatchObject([
      { referenceKey: "rent", defaultRole: "purchase", defaultCategoryId: rent },
    ]);
    expect((yield* rules.list).find((row) => row.id === rule.id)?.conditions.counterpartyId).toBe(
      duplicate.id,
    );
    expect(yield* activeEvent("Transfer to xx9921 CommBank app")).toMatchObject({
      counterpartyId: duplicate.id,
      counterpartySource: "user",
    });
    expect((yield* counterparties.get({ counterpartyId: jane.id })).references).toMatchObject(
      janesRent,
    );
  }).pipe(Effect.provide(services)),
);

test(
  "merging a counterparty named only by the linked-away side of a transfer moves that side too, and undo restores it",
  Effect.gen(function* () {
    yield* reset;
    const everyday = yield* account();
    const card = yield* (yield* Accounts).create({
      commandId: yield* commandId,
      label: "Card",
      kind: "card",
      institution: "commbank",
      currency: "AUD",
    });
    const publication = yield* Publication;
    for (const [owner, row] of [
      [
        everyday,
        {
          description: "Transfer to xx9999 CommBank app Card",
          postedOn: "2026-07-20",
          minor: -12000n,
        },
      ],
      [card, { description: "Payment Received, Thank You", postedOn: "2026-07-21", minor: 12000n }],
    ] as const) {
      const file = yield* source(owner.id);
      yield* publication.publish({ ...parsedRows([row]), importId: file.importId });
    }
    const payments = yield* createCounterparty({ name: "Card payments", kind: "ownAccount" }, [
      "ACCOUNT 9999",
    ]);
    const transfer = yield* activeEvent("Transfer to xx9999 CommBank app Card");
    expect(transfer.counterpartyId).toBe(payments.id);
    const relationships = yield* Relationships;
    const change = {
      kind: "linkMovement",
      eventId: (yield* activeEvent("Payment Received, Thank You")).id,
      movementKind: "cardSettlement",
      counterpart: { kind: "event", eventId: transfer.id },
    } as const;
    yield* relationships.apply({
      commandId: yield* commandId,
      change,
      expectedVersions: (yield* relationships.preview({ change })).expectedVersions,
    });
    const events = yield* Events;
    expect(yield* events.get({ eventId: transfer.id })).toMatchObject({
      active: false,
      counterpartyId: payments.id,
    });

    const creditCard = yield* createCounterparty({ name: "Credit card", kind: "ownAccount" }, []);
    const merged = yield* apply({
      kind: "merge",
      sourceId: payments.id,
      sourceVersion: payments.version,
      targetId: creditCard.id,
      targetVersion: creditCard.version,
    });
    expect((yield* events.get({ eventId: transfer.id })).counterpartyId).toBe(creditCard.id);
    if (!merged.changeId) return yield* Effect.die("Expected the merge in history");
    yield* (yield* CounterpartyHistory).undo({
      commandId: yield* commandId,
      changeId: merged.changeId,
    });
    expect((yield* events.get({ eventId: transfer.id })).counterpartyId).toBe(payments.id);
  }).pipe(Effect.provide(services)),
);

test(
  "a category archived since stays on the records a merge and its undo write back, but cannot be newly chosen",
  Effect.gen(function* () {
    yield* publish([
      { description: "Transfer To J Smith NetBank Rent", postedOn: "2026-08-15", minor: -60000n },
    ]);
    const strata = yield* categoryId("housing.strata");
    const jane = yield* createCounterparty(
      { name: "Jane Smith", kind: "person", defaultRole: "purchase" },
      ["JANE SMITH"],
    );
    const duplicate = yield* createCounterparty(
      { name: "J Smith", kind: "person", defaultRole: "purchase" },
      ["J SMITH"],
    );
    const rentDefault = {
      kind: "saveReference",
      counterpartyId: duplicate.id,
      referenceKey: "rent",
      expectedVersion: null,
      defaultRole: "purchase",
      defaultCategoryId: strata,
    } as const;
    yield* apply(rentDefault);
    const category = (yield* (yield* Events).references).categories.find(
      (row) => row.id === strata,
    );
    if (!category) return yield* Effect.die("Expected the Strata category");
    yield* (yield* References).save({
      commandId: yield* commandId,
      record: {
        kind: "category",
        target: { kind: "update", id: strata, expectedVersion: category.version },
        name: category.name,
        parentId: category.parentId,
        archived: true,
      },
    });

    const chosen = yield* (yield* Counterparties)
      .apply({
        commandId: yield* commandId,
        change: { ...rentDefault, counterpartyId: jane.id },
      })
      .pipe(Effect.flip);
    expect(chosen).toMatchObject({ kind: "invalid", message: "Choose an active category." });
    const merged = yield* apply({
      kind: "merge",
      sourceId: duplicate.id,
      sourceVersion: duplicate.version,
      targetId: jane.id,
      targetVersion: jane.version,
    });
    if (!merged.changeId) return yield* Effect.die("Expected the merge in history");
    yield* (yield* CounterpartyHistory).undo({
      commandId: yield* commandId,
      changeId: merged.changeId,
    });
    expect(
      (yield* (yield* Counterparties).get({ counterpartyId: duplicate.id })).references,
    ).toMatchObject([{ referenceKey: "rent", defaultCategoryId: strata }]);
  }).pipe(Effect.provide(services)),
);

test(
  "merging keeps an unconfirmed descriptor as a question about the target",
  Effect.gen(function* () {
    yield* publish([
      {
        description: "WOOLWORTHS 1234 SYDNEY AU Card xx1234",
        postedOn: "2026-08-04",
        minor: -4200n,
      },
      { description: metro, postedOn: "2026-08-06", minor: -2500n },
    ]);
    const enrichment = yield* Enrichment;
    const run = yield* enrichment.request({ commandId: yield* commandId });
    const batch = yield* enrichment.batch({ runId: run.id });
    const answer = (aliasKey: string, confidence: number) =>
      ({
        aliasKey,
        existingCounterpartyId: null,
        name: "Woolworths",
        kind: "business",
        brand: null,
        categoryKey: "food.groceries",
        defaultRole: null,
        confidence,
        reason: "Probably the same supermarket chain.",
        proposedSubcategory: null,
      }) satisfies EnrichmentResult;
    yield* enrichment.complete({
      commandId: yield* commandId,
      runId: run.id,
      aliasKeys: batch.aliases.map((alias) => alias.aliasKey),
      report: {
        status: "success",
        results: [answer("WOOLWORTHS SYDNEY", 0.95), answer("WOOLWORTHS METRO SURRY HILLS", 0.5)],
        inputTokens: 1000n,
        outputTokens: 200n,
        cost: { currency: "USD", minor: 2n },
        failure: null,
      },
    });
    const suggested = (yield* activeEvent("WOOLWORTHS 1234 SYDNEY AU Card xx1234")).counterpartyId;
    if (!suggested) return yield* Effect.die("Expected the model's Woolworths");
    const counterparties = yield* Counterparties;
    const source = (yield* counterparties.get({ counterpartyId: suggested })).counterparty;
    const group = yield* createCounterparty({ name: "Woolworths Group" }, []);
    yield* apply({
      kind: "merge",
      sourceId: source.id,
      sourceVersion: source.version,
      targetId: group.id,
      targetVersion: group.version,
    });
    expect(
      (yield* counterparties.get({ counterpartyId: group.id })).aliases.map((alias) => [
        alias.aliasKey,
        alias.source,
        alias.status,
      ]),
    ).toEqual([
      ["WOOLWORTHS SYDNEY", "user", "applied"],
      ["WOOLWORTHS METRO SURRY HILLS", "model", "proposed"],
    ]);
    expect((yield* activeEvent(metro)).counterpartyId).toBeNull();
    expect((yield* openQuestions).filter((question) => question.kind === "alias")).toMatchObject([
      {
        aliasKey: "WOOLWORTHS METRO SURRY HILLS",
        aliasVersion: 2,
        counterparty: { id: group.id, name: "Woolworths Group" },
        basis: { kind: "model", confidence: 0.5, reason: "Probably the same supermarket chain." },
      },
    ]);
  }).pipe(Effect.provide(services)),
);

test(
  "unlinking a movement after its counterparty was merged restores the event to the merged counterparty",
  Effect.gen(function* () {
    yield* publish([
      { description: "Transfer to xx9921 CommBank app", postedOn: "2026-08-20", minor: -50000n },
    ]);
    const savings = yield* createCounterparty({ name: "ING savings", kind: "ownAccount" }, [
      "ACCOUNT 9921",
    ]);
    const bank = yield* createCounterparty({ name: "ING", kind: "ownAccount" }, []);
    const transfer = yield* activeEvent("Transfer to xx9921 CommBank app");
    expect(transfer.counterpartyId).toBe(savings.id);
    const relationships = yield* Relationships;
    const relate = Effect.fn(function* (
      change: Parameters<(typeof relationships)["preview"]>[0]["change"],
    ) {
      const preview = yield* relationships.preview({ change });
      yield* relationships.apply({
        commandId: yield* commandId,
        change,
        expectedVersions: preview.expectedVersions,
      });
    });
    yield* relate({
      kind: "linkMovement",
      eventId: transfer.id,
      movementKind: "transfer",
      counterpart: { kind: "external", label: "ING savings" },
    });
    yield* apply({
      kind: "merge",
      sourceId: savings.id,
      sourceVersion: savings.version,
      targetId: bank.id,
      targetVersion: bank.version,
    });
    yield* relate({ kind: "unlinkMovement", eventId: transfer.id });
    expect((yield* activeEvent("Transfer to xx9921 CommBank app")).counterpartyId).toBe(bank.id);
  }).pipe(Effect.provide(services)),
);

test(
  "an older counterparty change cannot be undone until the later change to the same record is undone, and the history says which can",
  Effect.gen(function* () {
    yield* publish([
      {
        description: "WOOLWORTHS 1234 SYDNEY AU Card xx1234",
        postedOn: "2026-08-04",
        minor: -4200n,
      },
    ]);
    const groceries = yield* categoryId("food.groceries");
    const created = yield* createCounterparty(
      { name: "Woolworths", defaultCategoryId: groceries },
      ["WOOLWORTHS SYDNEY"],
    );
    const dining = yield* updateCounterparty(created, {
      defaultCategoryId: yield* categoryId("food.dining-out"),
    });
    yield* updateCounterparty(dining, { defaultCategoryId: yield* categoryId("shopping.home") });
    const history = yield* CounterpartyHistory;
    const page = Effect.map(history.list({ counterpartyId: created.id }), (result) => result.rows);
    const [second, first] = yield* page;
    if (!first || !second) return yield* Effect.die("Expected both changes");
    expect([second.undoable, first.undoable]).toEqual([true, false]);
    const early = yield* history
      .undo({ commandId: yield* commandId, changeId: first.id })
      .pipe(Effect.flip);
    expect(early).toMatchObject({
      kind: "stale",
      message: "A later change touched these records. Undo it first.",
    });
    yield* history.undo({ commandId: yield* commandId, changeId: second.id });
    expect((yield* page).map((row) => [row.kind, row.undoable])).toEqual([
      ["undo", true],
      ["update", false],
      ["update", true],
      ["create", false],
    ]);
    yield* history.undo({ commandId: yield* commandId, changeId: first.id });
    expect(
      (yield* activeEvent("WOOLWORTHS 1234 SYDNEY AU Card xx1234")).allocations[0],
    ).toMatchObject({ categoryId: groceries, categorySource: "counterparty" });
  }).pipe(Effect.provide(services)),
);

test(
  "undoing a counterparty's creation returns its descriptors to their previous counterparty, and is refused while a transaction is assigned to it by hand",
  Effect.gen(function* () {
    const { coles } = yield* misidentified;
    const created = yield* apply({
      kind: "create",
      fields: {
        name: "Woolworths Metro",
        kind: "business",
        brand: "Woolworths",
        defaultCategoryId: yield* categoryId("food.groceries"),
        defaultRole: null,
      },
      aliases: [{ aliasKey: "WOOLWORTHS METRO SURRY HILLS", expectedVersion: 1 }],
    });
    expect((yield* activeEvent(metro)).counterpartyId).toBe(created.counterparty.id);
    const corrections = yield* Corrections;
    const assign = Effect.fn(function* (counterpartyId: typeof created.counterparty.id | null) {
      const event = yield* activeEvent("COLES 0456 NEWTOWN AU Card xx1234");
      yield* corrections.assignCounterparty({
        commandId: yield* commandId,
        eventId: event.id,
        counterpartyId,
        expectedVersions: [{ eventId: event.id, version: event.version }],
      });
    });
    yield* assign(created.counterparty.id);
    if (!created.changeId) return yield* Effect.die("Expected the creation in history");
    const history = yield* CounterpartyHistory;
    const refused = yield* history
      .undo({ commandId: yield* commandId, changeId: created.changeId })
      .pipe(Effect.flip);
    expect(refused).toMatchObject({
      kind: "conflict",
      message: "Woolworths Metro still has 1 transaction. Move them to another counterparty first.",
    });
    expect((yield* activeEvent(metro)).counterpartyId).toBe(created.counterparty.id);

    yield* assign(null);
    const undone = yield* history.undo({ commandId: yield* commandId, changeId: created.changeId });
    expect(undone.removed).toEqual([created.counterparty.id]);
    expect((yield* activeEvent(metro)).counterpartyId).toBe(coles.id);
    expect(yield* augustOutflows).toEqual([
      ["Coles", 4300n, 2],
      ["Woolworths", 4200n, 1],
    ]);
  }).pipe(Effect.provide(services)),
);

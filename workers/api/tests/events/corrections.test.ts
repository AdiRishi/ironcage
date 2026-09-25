import {
  AllocationId,
  type AssignEventCounterparty,
  CategoryId,
  CommandId,
  type CounterpartyId,
  type EventChange,
  type EventId,
} from "@repo/contracts/finance";
import { Crypto, Effect } from "effect";
import { expect } from "vitest";

import { Corrections } from "../../src/events/corrections.ts";
import { Events } from "../../src/events/service.ts";
import { Publication } from "../../src/imports/publication.ts";
import { Counterparties } from "../../src/interpretation/counterparties.ts";
import { CounterpartyHistory } from "../../src/interpretation/counterparty-history.ts";
import { Postings } from "../../src/postings/service.ts";
import { References } from "../../src/references/service.ts";
import { applicationTest } from "../support/application.ts";
import {
  account,
  createCounterparty,
  parsed,
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
const purchase = Effect.gen(function* () {
  yield* reset;
  const owner = yield* account();
  const file = yield* source(owner.id);
  const data = parsed(["Synthetic grocery Card xx1234"]);
  const publication = yield* Publication;
  yield* publication.publish({
    ...data,
    observations: data.observations.map((row) => ({
      ...row,
      candidate: row.candidate
        ? { ...row.candidate, amount: { currency: "AUD", minor: -15000n } }
        : null,
    })),
    importId: file.importId,
  });
  const events = yield* Events;
  yield* events.interpret({ commandId: yield* commandId });
  const postings = yield* Postings;
  const [posting] = (yield* postings.list({ filter: {} })).rows;
  if (!posting) return yield* Effect.die("Expected posting");
  const event = yield* events.forPosting({ postingId: posting.id });
  if (!event) return yield* Effect.die("Expected event");
  const [allocation] = event.allocations;
  if (!allocation) return yield* Effect.die("Expected allocation");
  return { event, posting, allocation };
});
test(
  "splits conserve money, stale saves fail, and undo records a new correction",
  Effect.gen(function* () {
    const { event, allocation, posting } = yield* purchase;
    const corrections = yield* Corrections;
    const groceries = CategoryId.make("00000000-0000-4000-8000-000000000001");
    const household = CategoryId.make("00000000-0000-4000-8000-000000000002");
    const split = {
      eventId: event.id,
      kind: event.kind,
      purchaseOn: null,
      allocations: [
        { ...allocation, categoryId: groceries, amount: { currency: "AUD", minor: 10000n } },
        {
          ...allocation,
          id: AllocationId.make(yield* Crypto.Crypto.use((crypto) => crypto.randomUUIDv4)),
          categoryId: household,
          amount: { currency: "AUD", minor: 5000n },
        },
      ],
    } satisfies EventChange;
    const preview = yield* corrections.preview({ change: split });
    const [september] = preview.impacts;
    expect(september?.before.spending.minor).toBe(15000n);
    expect(september?.after.spending.minor).toBe(15000n);
    expect(september?.after.outflow.minor).toBe(15000n);
    const input = {
      commandId: yield* commandId,
      change: split,
      expectedVersions: preview.expectedVersions,
    };
    const accepted = yield* corrections.apply(input);
    expect(accepted.allocations.map((row) => row.amount.minor)).toEqual([10000n, 5000n]);
    expect(yield* corrections.apply(input)).toEqual(accepted);
    const stale = yield* corrections
      .apply({ ...input, commandId: yield* commandId })
      .pipe(Effect.result);
    expect(stale._tag === "Failure" && stale.failure.kind).toBe("stale");
    const history = yield* corrections.history({ eventId: event.id });
    expect(history.entries).toHaveLength(1);
    const [entry] = history.entries;
    if (entry?.kind !== "correction") return yield* Effect.die("Expected correction");
    const undone = yield* corrections.undo({
      commandId: yield* commandId,
      correctionId: entry.correction.id,
      expectedVersions: [{ eventId: event.id, version: accepted.version }],
    });
    expect(undone.allocations).toEqual(event.allocations);
    expect((yield* corrections.history({ eventId: event.id })).entries).toHaveLength(2);
    const postings = yield* Postings;
    expect((yield* postings.get({ postingId: posting.id })).posting).toEqual(posting);
    const invalid = yield* corrections
      .preview({
        change: {
          ...split,
          allocations: [{ ...allocation, amount: { currency: "AUD", minor: 15100n } }],
        },
      })
      .pipe(Effect.result);
    expect(invalid._tag === "Failure" && invalid.failure.kind).toBe("conflict");
  }).pipe(Effect.provide(services)),
);

test(
  "renaming a category preserves assignments and interpretation reruns preserve corrections",
  Effect.gen(function* () {
    const { event, allocation } = yield* purchase;
    const corrections = yield* Corrections;
    const references = yield* References;
    const events = yield* Events;
    const category = (yield* events.references).categories[0];
    if (!category) return yield* Effect.die("Expected seeded category");
    const change = {
      eventId: event.id,
      kind: event.kind,
      purchaseOn: null,
      allocations: [{ ...allocation, categoryId: category.id }],
    } satisfies EventChange;
    const accepted = yield* corrections.apply({
      commandId: yield* commandId,
      change,
      expectedVersions: [{ eventId: event.id, version: event.version }],
    });
    yield* references.save({
      commandId: yield* commandId,
      record: {
        kind: "category",
        target: { kind: "update", id: category.id, expectedVersion: category.version },
        name: "Renamed category",
        parentId: null,
        archived: false,
      },
    });
    expect((yield* events.references).categories.find((row) => row.id === category.id)?.name).toBe(
      "Renamed category",
    );
    expect((yield* events.get({ eventId: event.id })).allocations[0]?.categoryId).toBe(category.id);
    expect((yield* events.interpret({ commandId: yield* commandId })).created).toBe(0);
    expect(yield* events.get({ eventId: event.id })).toEqual(accepted);
    const deletion = yield* references
      .remove({
        commandId: yield* commandId,
        record: { kind: "category", id: category.id, expectedVersion: category.version + 1 },
      })
      .pipe(Effect.result);
    expect(deletion._tag === "Failure" && deletion.failure.kind).toBe("conflict");
  }).pipe(Effect.provide(services)),
);

// A $42.00 Woolworths purchase in Groceries, and Coles, whose default is General.
const stores = Effect.gen(function* () {
  yield* reset;
  const owner = yield* account();
  const file = yield* source(owner.id);
  yield* (yield* Publication).publish({
    ...parsedRows([
      {
        description: "WOOLWORTHS 1234 SYDNEY AU Card xx1234",
        postedOn: "2026-08-04",
        minor: -4200n,
      },
      {
        description: "WOOLWORTHS 5678 SYDNEY AU Card xx1234",
        postedOn: "2026-08-05",
        minor: -1500n,
      },
      { description: "COLES 0456 NEWTOWN AU Card xx1234", postedOn: "2026-08-08", minor: -1800n },
    ]),
    importId: file.importId,
  });
  const groceries = yield* categoryId("food.groceries");
  const woolworths = yield* createCounterparty(
    { name: "Woolworths", defaultCategoryId: groceries },
    ["WOOLWORTHS SYDNEY"],
  );
  const coles = yield* createCounterparty(
    { name: "Coles", defaultCategoryId: yield* categoryId("shopping.general") },
    ["COLES NEWTOWN"],
  );
  return { woolworths, coles, groceries };
});
const purchaseAt = "WOOLWORTHS 1234 SYDNEY AU Card xx1234";
const latestCorrection = Effect.fn(function* (eventId: typeof EventId.Type) {
  const [entry] = (yield* (yield* Corrections).history({ eventId })).entries;
  if (entry?.kind !== "correction") return yield* Effect.die("Expected a correction");
  return entry.correction;
});

test(
  "moving one transaction to another counterparty applies that counterparty's defaults, is listed in its history, and undo returns it to its descriptor's counterparty with inherited values",
  Effect.gen(function* () {
    const { woolworths, coles, groceries } = yield* stores;
    const general = yield* categoryId("shopping.general");
    const corrections = yield* Corrections;
    const purchase = yield* activeEvent(purchaseAt);
    const preview = yield* corrections.previewCounterparty({
      eventId: purchase.id,
      counterpartyId: coles.id,
    });
    expect(preview.after).toMatchObject({
      counterpartyId: coles.id,
      allocations: [{ categoryId: general, categorySource: "counterparty" }],
    });
    expect(preview.expectedVersions).toEqual([{ eventId: purchase.id, version: purchase.version }]);
    expect(yield* activeEvent(purchaseAt)).toEqual(purchase);
    const moved = yield* corrections.assignCounterparty({
      commandId: yield* commandId,
      eventId: purchase.id,
      counterpartyId: coles.id,
      expectedVersions: preview.expectedVersions,
    });
    expect(moved).toMatchObject({
      counterpartyId: coles.id,
      counterpartySource: "user",
      allocations: [{ categoryId: general, categorySource: "counterparty" }],
    });
    const history = yield* corrections.history({ eventId: purchase.id });
    expect(history.entries.map((entry) => entry.kind)).toEqual(["correction", "counterparty"]);
    expect(history.entries[0]).toMatchObject({
      correction: { action: "correct", change: "counterparty" },
    });
    expect(history.names.toSorted((a, b) => a.name.localeCompare(b.name))).toEqual([
      { id: coles.id, name: "Coles" },
      { id: woolworths.id, name: "Woolworths" },
    ]);

    const correction = yield* latestCorrection(purchase.id);
    const undoPreview = yield* corrections.previewUndo({ correctionId: correction.id });
    expect(undoPreview.after).toMatchObject({ counterpartyId: woolworths.id });
    const undone = yield* corrections.undo({
      commandId: yield* commandId,
      correctionId: correction.id,
      expectedVersions: undoPreview.expectedVersions,
    });
    expect(undone).toMatchObject({
      counterpartyId: woolworths.id,
      counterpartySource: "alias",
      allocations: [{ categoryId: groceries, categorySource: "counterparty" }],
    });
  }).pipe(Effect.provide(services)),
);

test(
  "a move repeated with its command ID moves the transaction once, the command ID sent with other input fails with conflict, and a move sent at an old version fails with stale and changes nothing",
  Effect.gen(function* () {
    const { coles } = yield* stores;
    const corrections = yield* Corrections;
    const purchase = yield* activeEvent(purchaseAt);
    const move = {
      commandId: yield* commandId,
      eventId: purchase.id,
      counterpartyId: coles.id,
      expectedVersions: [{ eventId: purchase.id, version: purchase.version }],
    } satisfies typeof AssignEventCounterparty.Type;
    const moved = yield* corrections.assignCounterparty(move);
    expect(yield* corrections.assignCounterparty(move)).toEqual(moved);
    const reused = yield* corrections
      .assignCounterparty({ ...move, counterpartyId: null })
      .pipe(Effect.flip);
    expect(reused.kind).toBe("conflict");
    const stale = yield* corrections
      .assignCounterparty({ ...move, commandId: yield* commandId, counterpartyId: null })
      .pipe(Effect.flip);
    expect(stale.kind).toBe("stale");
    expect(yield* activeEvent(purchaseAt)).toEqual(moved);
    expect(
      (yield* corrections.history({ eventId: purchase.id })).entries.filter(
        (entry) => entry.kind === "correction",
      ),
    ).toHaveLength(1);
  }).pipe(Effect.provide(services)),
);

test(
  "undoing a move back to a counterparty that was merged away since fails with conflict, leaves the transaction where it is, and still names that counterparty",
  Effect.gen(function* () {
    const { woolworths, coles } = yield* stores;
    const corrections = yield* Corrections;
    const metro = yield* createCounterparty({ name: "Woolworths Metro" }, []);
    const move = Effect.fn(function* (counterpartyId: typeof CounterpartyId.Type) {
      const event = yield* activeEvent(purchaseAt);
      return yield* corrections.assignCounterparty({
        commandId: yield* commandId,
        eventId: event.id,
        counterpartyId,
        expectedVersions: [{ eventId: event.id, version: event.version }],
      });
    });
    yield* move(metro.id);
    const moved = yield* move(coles.id);
    yield* (yield* Counterparties).apply({
      commandId: yield* commandId,
      change: {
        kind: "merge",
        sourceId: metro.id,
        sourceVersion: metro.version,
        targetId: woolworths.id,
        targetVersion: woolworths.version,
      },
    });
    const refused = yield* corrections
      .undo({
        commandId: yield* commandId,
        correctionId: (yield* latestCorrection(moved.id)).id,
        expectedVersions: [{ eventId: moved.id, version: moved.version }],
      })
      .pipe(Effect.flip);
    expect(refused).toMatchObject({
      kind: "conflict",
      message:
        "That counterparty was merged or removed. Use Change to choose who the transaction was with.",
    });
    expect(yield* activeEvent(purchaseAt)).toEqual(moved);
    // The history still names the counterparty the merge removed.
    expect((yield* corrections.history({ eventId: moved.id })).names).toContainEqual({
      id: metro.id,
      name: "Woolworths Metro",
    });
  }).pipe(Effect.provide(services)),
);

test(
  "undoing a category correction lets a later counterparty default reach the transaction again",
  Effect.gen(function* () {
    const { woolworths } = yield* stores;
    const corrections = yield* Corrections;
    const purchase = yield* activeEvent(purchaseAt);
    const [allocation] = purchase.allocations;
    const corrected = yield* corrections.apply({
      commandId: yield* commandId,
      expectedVersions: [{ eventId: purchase.id, version: purchase.version }],
      change: {
        eventId: purchase.id,
        kind: purchase.kind,
        purchaseOn: null,
        allocations: [{ ...allocation, categoryId: yield* categoryId("food.dining-out") }],
      },
    });
    yield* corrections.undo({
      commandId: yield* commandId,
      correctionId: (yield* latestCorrection(purchase.id)).id,
      expectedVersions: [{ eventId: purchase.id, version: corrected.version }],
    });
    const home = yield* categoryId("shopping.home");
    yield* updateCounterparty(woolworths, { defaultCategoryId: home });
    expect((yield* activeEvent(purchaseAt)).allocations).toMatchObject([
      { categoryId: home, categorySource: "counterparty" },
    ]);
  }).pipe(Effect.provide(services)),
);

test(
  "a counterparty change is listed in the history of each transaction it changed and of no other",
  Effect.gen(function* () {
    const { woolworths } = yield* stores;
    const corrections = yield* Corrections;
    const purchase = yield* activeEvent(purchaseAt);
    const [allocation] = purchase.allocations;
    yield* corrections.apply({
      commandId: yield* commandId,
      expectedVersions: [{ eventId: purchase.id, version: purchase.version }],
      change: {
        eventId: purchase.id,
        kind: purchase.kind,
        purchaseOn: null,
        allocations: [{ ...allocation, categoryId: yield* categoryId("food.dining-out") }],
      },
    });
    yield* updateCounterparty(woolworths, {
      defaultCategoryId: yield* categoryId("shopping.home"),
    });
    const [update] = (yield* (yield* CounterpartyHistory).list({ counterpartyId: woolworths.id }))
      .rows;
    expect(update).toMatchObject({ kind: "update", eventCount: 1 });
    const lists = Effect.fn(function* (description: string) {
      const event = yield* activeEvent(description);
      return (yield* corrections.history({ eventId: event.id })).entries.some(
        (entry) => entry.kind === "counterparty" && entry.change.id === update?.id,
      );
    });
    expect(yield* lists("WOOLWORTHS 5678 SYDNEY AU Card xx1234")).toBe(true);
    expect(yield* lists(purchaseAt)).toBe(false);
    expect(yield* lists("COLES 0456 NEWTOWN AU Card xx1234")).toBe(false);
  }).pipe(Effect.provide(services)),
);

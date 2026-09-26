import { describe, expect, it } from "@effect/vitest";
import {
  AccountId,
  AllocationId,
  CalendarDate,
  CategoryId,
  CounterpartyId,
  EventId,
  PersonalEventId,
  PostingId,
  TagId,
  type FinancialEvent,
} from "@repo/contracts/finance";
import { Effect, Result } from "effect";

import {
  assignCounterparty,
  correctEvent,
  deriveInterpretation,
  patchEvent,
  restoreEvent,
  ruleActions,
  type CounterpartyDefaults,
} from "../src/index.ts";

const id = (prefix: string, n: number) => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const groceries = CategoryId.make(id("10000000", 1));
const diningOut = CategoryId.make(id("10000000", 2));
const household = CategoryId.make(id("10000000", 3));
const rent = CategoryId.make(id("10000000", 4));
const woolworths = CounterpartyId.make(id("50000000", 1));
const coles = CounterpartyId.make(id("50000000", 2));
const everyday = AccountId.make(id("00000000", 1));
const postingId = PostingId.make(id("20000000", 1));
const allocationId = AllocationId.make(id("40000000", 1));
const work = TagId.make(id("60000000", 1));
const travel = TagId.make(id("60000000", 2));
const japanTrip = PersonalEventId.make(id("70000000", 1));
const aud = (minor: bigint) => ({ currency: "AUD", minor });

// A $42.00 card purchase at Woolworths, filed in Groceries by Woolworths's default.
function purchase(fields: Partial<FinancialEvent> = {}): FinancialEvent {
  return {
    id: EventId.make(id("30000000", 1)),
    kind: "purchase",
    roleSource: "bank",
    counterpartyId: woolworths,
    counterpartySource: "alias",
    magnitude: aud(4200n),
    primaryPostingId: postingId,
    reportingAccountId: everyday,
    purchaseOn: null,
    active: true,
    version: 1,
    allocations: [
      {
        id: allocationId,
        role: "purchase",
        amount: aud(4200n),
        categoryId: groceries,
        categorySource: "counterparty",
        nonPersonal: false,
        tagIds: [],
        personalEventIds: [],
      },
    ],
    postings: [
      {
        id: postingId,
        accountId: everyday,
        accountLabel: "Everyday",
        postedOn: CalendarDate.make("2026-08-03"),
        valueOn: null,
        amount: aud(-4200n),
        description: "WOOLWORTHS 1234 SYDNEY AU Card xx1234",
        originalMoney: null,
      },
    ],
    ...fields,
  };
}
const business = (fields: Partial<CounterpartyDefaults> = {}): CounterpartyDefaults => ({
  id: woolworths,
  kind: "business",
  defaultRole: null,
  defaultCategoryId: groceries,
  applied: true,
  ...fields,
});
// What reinterpreting a Woolworths card purchase decides after a write.
const reinterpret = (event: FinancialEvent, counterparty: CounterpartyDefaults) =>
  deriveInterpretation({
    event,
    amountMinor: -4200n,
    bank: { role: "purchase", categorySlug: null },
    aliasCounterpartyId: woolworths,
    counterparty,
    rules: ruleActions([]),
    categoryTree: () => "spending",
    categoryIdForSlug: () => null,
  });

describe("correctEvent", () => {
  const unchanged = (event: FinancialEvent) => ({
    eventId: event.id,
    kind: event.kind,
    purchaseOn: event.purchaseOn,
    allocations: event.allocations,
  });

  it.effect("makes a value it keeps yours only when the event's rules dispute it", () =>
    Effect.gen(function* () {
      const kept = yield* correctEvent(purchase(), unchanged(purchase()), []);
      expect(kept.roleSource).toBe("bank");
      expect(kept.allocations[0]?.categorySource).toBe("counterparty");

      const category = yield* correctEvent(purchase(), unchanged(purchase()), ["category"]);
      expect(category.roleSource).toBe("bank");
      expect(category.allocations[0]).toMatchObject({
        categoryId: groceries,
        categorySource: "user",
      });

      const role = yield* correctEvent(purchase(), unchanged(purchase()), ["role"]);
      expect(role.roleSource).toBe("user");
    }),
  );
});

describe("patchEvent", () => {
  it.effect("marks a purchase non-personal and keeps its amount, role, and category", () =>
    Effect.gen(function* () {
      const change = Result.getOrThrow(patchEvent(purchase(), { nonPersonal: true }));
      expect(change).toEqual({
        eventId: purchase().id,
        kind: "purchase",
        purchaseOn: null,
        allocations: [
          {
            id: allocationId,
            role: "purchase",
            amount: aud(4200n),
            categoryId: groceries,
            categorySource: "counterparty",
            nonPersonal: true,
            tagIds: [],
            personalEventIds: [],
          },
        ],
      });
      const corrected = yield* correctEvent(purchase(), change, []);
      expect(corrected.allocations[0]).toMatchObject({ amount: aud(4200n), nonPersonal: true });
    }),
  );

  it("adds and removes only the labels it names, and sets what it names to null", () => {
    const labelled = purchase({
      purchaseOn: CalendarDate.make("2026-08-01"),
      allocations: [
        { ...purchase().allocations[0], tagIds: [work], personalEventIds: [japanTrip] },
      ],
    });
    const change = Result.getOrThrow(
      patchEvent(labelled, {
        categoryId: null,
        purchaseOn: null,
        addTagIds: [travel, travel],
        removeTagIds: [work],
        addPersonalEventIds: [japanTrip],
      }),
    );
    expect(change.purchaseOn).toBeNull();
    expect(change.allocations).toEqual([
      expect.objectContaining({
        categoryId: null,
        tagIds: [travel],
        personalEventIds: [japanTrip],
      }),
    ]);
  });

  it("gives the allocation the role the new financial role gives it", () => {
    const change = Result.getOrThrow(patchEvent(purchase(), { role: "loanPayment" }));
    expect(change.kind).toBe("loanPayment");
    expect(change.allocations[0].role).toBe("transfer");
  });

  it.effect("refuses a split, whose parts change together in the editor", () =>
    Effect.gen(function* () {
      const [allocation] = purchase().allocations;
      const split = purchase({
        allocations: [
          { ...allocation, amount: aud(2100n) },
          { ...allocation, id: AllocationId.make(id("40000000", 2)), amount: aud(2100n) },
        ],
      });
      const error = yield* Effect.flip(Effect.fromResult(patchEvent(split, { nonPersonal: true })));
      expect(error.message).toBe("Open the transaction to change a split.");
    }),
  );
});

describe("restoreEvent", () => {
  it.effect("returns an event's role and category with the sources they had before", () =>
    Effect.gen(function* () {
      const original = purchase({
        roleSource: "counterparty",
        allocations: [{ ...purchase().allocations[0], categoryId: rent }],
      });
      const corrected = yield* correctEvent(
        original,
        {
          eventId: original.id,
          kind: "transfer",
          purchaseOn: null,
          allocations: [{ ...original.allocations[0], role: "transfer", categoryId: null }],
        },
        [],
      );
      const restored = yield* restoreEvent(corrected, original);
      expect(restored.kind).toBe("purchase");
      expect(restored.roleSource).toBe("counterparty");
      expect(restored.allocations).toEqual([
        expect.objectContaining({
          role: "purchase",
          categoryId: rent,
          categorySource: "counterparty",
        }),
      ]);
      expect(restored.version).toBe(3);
    }),
  );

  it.effect("keeps a movement link's role only while the link exists", () =>
    Effect.gen(function* () {
      const transfer = purchase({
        kind: "transfer",
        allocations: [{ ...purchase().allocations[0], role: "transfer", categoryId: null }],
      });
      const linked = { ...transfer, roleSource: "link" as const };
      expect((yield* restoreEvent(linked, transfer)).roleSource).toBe("link");
      expect((yield* restoreEvent(transfer, linked)).roleSource).toBeNull();
    }),
  );

  it.effect("refuses allocations that no longer sum to the event's magnitude", () =>
    Effect.gen(function* () {
      const before = purchase({
        magnitude: aud(4000n),
        allocations: [{ ...purchase().allocations[0], amount: aud(4000n) }],
      });
      const error = yield* Effect.flip(restoreEvent(purchase(), before));
      expect(error.kind).toBe("conflict");
    }),
  );

  it.effect(
    "lets a later counterparty default reach a transaction whose category correction was undone",
    () =>
      Effect.gen(function* () {
        const original = purchase();
        const corrected = yield* correctEvent(
          original,
          {
            eventId: original.id,
            kind: "purchase",
            purchaseOn: null,
            allocations: [{ ...original.allocations[0], categoryId: diningOut }],
          },
          [],
        );
        const restored = yield* restoreEvent(corrected, original);
        const derived = reinterpret(restored, business({ defaultCategoryId: household }));
        expect(derived.categoryId).toBe(household);
        expect(derived.categorySource).toBe("counterparty");
      }),
  );
});

describe("assignCounterparty", () => {
  it.effect("keeps a moved transaction on its counterparty until you clear it", () =>
    Effect.gen(function* () {
      const moved = yield* assignCounterparty(purchase(), coles);
      expect(reinterpret(moved, business({ id: coles }))).toMatchObject({
        counterpartyId: coles,
        counterpartySource: "user",
      });
      const cleared = yield* assignCounterparty(moved, null);
      expect(reinterpret(cleared, business())).toMatchObject({
        counterpartyId: woolworths,
        counterpartySource: "alias",
      });
    }),
  );

  it.effect("refuses a transaction joined to another", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(assignCounterparty(purchase({ active: false }), coles));
      expect(error.kind).toBe("conflict");
    }),
  );
});

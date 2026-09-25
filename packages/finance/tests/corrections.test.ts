import { describe, expect, it } from "@effect/vitest";
import {
  AccountId,
  AllocationId,
  CalendarDate,
  CategoryId,
  CounterpartyId,
  EventId,
  PostingId,
  type FinancialEvent,
} from "@repo/contracts/finance";
import { Effect } from "effect";

import {
  assignCounterparty,
  correctEvent,
  deriveInterpretation,
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

describe("restoreEvent", () => {
  it.effect("returns an event's role and category with the sources they had before", () =>
    Effect.gen(function* () {
      const original = purchase({
        roleSource: "counterparty",
        allocations: [{ ...purchase().allocations[0], categoryId: rent }],
      });
      const corrected = yield* correctEvent(original, {
        eventId: original.id,
        kind: "transfer",
        purchaseOn: null,
        allocations: [{ ...original.allocations[0], role: "transfer", categoryId: null }],
      });
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
        const corrected = yield* correctEvent(original, {
          eventId: original.id,
          kind: "purchase",
          purchaseOn: null,
          allocations: [{ ...original.allocations[0], categoryId: diningOut }],
        });
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

import { CalendarDate, CommandId } from "@repo/contracts/finance";
import { Array as Arr, Crypto, Effect } from "effect";
import { expect } from "vitest";

import { Corrections } from "../../src/events/corrections.ts";
import { Publication } from "../../src/imports/publication.ts";
import { Postings } from "../../src/postings/service.ts";
import { applicationTest } from "../support/application.ts";
import { account, parsed, reset, source } from "../support/fixtures.ts";
import { activeEvent, populate } from "../support/populated.ts";

const { test, services } = applicationTest();
test(
  "transaction cursors do not skip same-day purchases and filters retain exact signs",
  Effect.gen(function* () {
    yield* reset;
    const owner = yield* account();
    const file = yield* source(owner.id);
    const publication = yield* Publication;
    yield* publication.publish({
      ...parsed(Array.from({ length: 55 }, (_, index) => `Purchase ${index}`)),
      importId: file.importId,
    });
    const postings = yield* Postings;
    const first = yield* postings.list({ filter: { accountId: owner.id } });
    expect(first.rows).toHaveLength(50);
    if (!first.nextCursor) return yield* Effect.die("Expected the next page");
    const second = yield* postings.list({
      filter: { accountId: owner.id },
      cursor: first.nextCursor,
    });
    expect(second.rows).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.rows, ...second.rows].map((row) => row.id)).size).toBe(55);
    const filtered = yield* postings.list({
      filter: { currency: "AUD", minimum: "-450", maximum: "-450", description: "Purchase 54" },
    });
    expect(filtered.rows.map((row) => row.description)).toEqual(["Purchase 54"]);
    expect((yield* postings.list({ filter: { minimum: "0" } })).rows).toHaveLength(0);
    expect((yield* postings.list({ filter: { currency: "USD" } })).rows).toHaveLength(0);
  }).pipe(Effect.provide(services)),
);

test(
  "the not yet categorised filter lists money whose role takes a category that it lacks",
  Effect.gen(function* () {
    yield* populate;
    const groceries = yield* activeEvent("WOOLWORTHS 1234 SYDNEY AU Card xx1234");
    yield* (yield* Corrections).apply({
      commandId: CommandId.make(yield* Crypto.Crypto.use((crypto) => crypto.randomUUIDv4)),
      expectedVersions: [{ eventId: groceries.id, version: groceries.version }],
      change: {
        eventId: groceries.id,
        kind: groceries.kind,
        purchaseOn: groceries.purchaseOn,
        allocations: Arr.map(groceries.allocations, (allocation) => ({
          ...allocation,
          categoryId: null,
          categorySource: null,
        })),
      },
    });
    const listed = (yield* (yield* Postings).ledger({
      filter: {
        categoryId: "uncategorised",
        from: CalendarDate.make("2026-07-01"),
        to: CalendarDate.make("2026-07-31"),
      },
    })).rows.map((row) => row.description);
    expect(listed).toContain("WOOLWORTHS 1234 SYDNEY AU Card xx1234");
    // A card payment and a loan repayment never take a category.
    expect(listed).not.toContain("Transfer to xx9999 CommBank app Card");
    expect(listed).not.toContain("Loan Repayment LN REPAY 123456789");
    expect(listed).not.toContain("Dinner Place SYDNEY AU Card xx1234");
  }).pipe(Effect.provide(services)),
);

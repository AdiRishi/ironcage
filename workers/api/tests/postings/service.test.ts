import { CalendarDate, CommandId } from "@repo/contracts/finance";
import { Array as Arr, Crypto, Effect } from "effect";
import { expect } from "vitest";

import { Corrections } from "../../src/events/corrections.ts";
import { Publication } from "../../src/imports/publication.ts";
import { Counterparties } from "../../src/interpretation/counterparties.ts";
import { Postings } from "../../src/postings/service.ts";
import { applicationTest } from "../support/application.ts";
import {
  account,
  createCounterparty,
  enrich,
  openQuestions,
  parsed,
  parsedRows,
  reset,
  source,
} from "../support/fixtures.ts";
import { activeEvent, categoryId, populate } from "../support/populated.ts";

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

test(
  "a transaction's detail names its descriptor, how many transactions would move with it, and the version of the alias that holds it",
  Effect.gen(function* () {
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
        {
          description: "WOOLWORTHS METRO 77 SURRY HILLS Card xx1234",
          postedOn: "2026-08-06",
          minor: -2500n,
        },
        { description: "Interest charged", postedOn: "2026-08-31", minor: -300n },
      ]),
      importId: file.importId,
    });
    const postings = yield* Postings;
    const descriptor = Effect.fn(function* (description: string) {
      const event = yield* activeEvent(description);
      return (yield* postings.get({ postingId: event.primaryPostingId })).descriptor;
    });
    expect(yield* descriptor("WOOLWORTHS 1234 SYDNEY AU Card xx1234")).toEqual({
      aliasKey: "WOOLWORTHS SYDNEY",
      counterpartyText: "WOOLWORTHS 1234 SYDNEY AU",
      eventCount: 2,
      aliasVersion: null,
    });
    expect(yield* descriptor("Interest charged")).toBeNull();
    // Woolworths also holds the Metro descriptor, which the count leaves out.
    yield* createCounterparty({ name: "Woolworths" }, [
      "WOOLWORTHS SYDNEY",
      "WOOLWORTHS METRO SURRY HILLS",
    ]);
    expect(yield* descriptor("WOOLWORTHS 1234 SYDNEY AU Card xx1234")).toMatchObject({
      eventCount: 2,
      aliasVersion: 1,
    });
    // A transaction moved to another counterparty by hand stays where it is when the
    // descriptor moves, unless the move is made from that transaction.
    const moved = yield* activeEvent("WOOLWORTHS 5678 SYDNEY AU Card xx1234");
    yield* (yield* Corrections).assignCounterparty({
      commandId: CommandId.make(yield* Crypto.Crypto.use((crypto) => crypto.randomUUIDv4)),
      eventId: moved.id,
      counterpartyId: (yield* createCounterparty({ name: "Newsagency" }, [])).id,
      expectedVersions: [{ eventId: moved.id, version: moved.version }],
    });
    expect(yield* descriptor("WOOLWORTHS 1234 SYDNEY AU Card xx1234")).toMatchObject({
      eventCount: 1,
    });
    expect(yield* descriptor("WOOLWORTHS 5678 SYDNEY AU Card xx1234")).toMatchObject({
      eventCount: 2,
    });
  }).pipe(Effect.provide(services)),
);

test(
  "either side of a linked movement names the descriptor of the side that names its counterparty",
  Effect.gen(function* () {
    yield* populate;
    const postings = yield* Postings;
    const { rows } = yield* postings.list({ filter: {} });
    const descriptor = Effect.fn(function* (description: string) {
      const posting = rows.find((row) => row.description === description);
      if (!posting) return yield* Effect.die(`Expected a posting for ${description}`);
      return (yield* postings.get({ postingId: posting.id })).descriptor;
    });
    const transfer = yield* descriptor("Transfer to xx9999 CommBank app Card");
    expect(transfer).toMatchObject({ aliasKey: "ACCOUNT 9999" });
    expect(yield* descriptor("Payment Received, Thank You")).toEqual(transfer);
  }).pipe(Effect.provide(services)),
);

test(
  "the ledger's open questions are exactly the transactions behind the questions",
  Effect.gen(function* () {
    yield* reset;
    const owner = yield* account();
    const file = yield* source(owner.id);
    yield* (yield* Publication).publish({
      ...parsedRows([
        {
          description: "WOOLWORTHS 1234 SYDNEY AU Card xx1234",
          postedOn: "2026-08-01",
          minor: -3000n,
        },
        {
          description: "WOOLWORTHS METRO 77 SURRY HILLS Card xx1234",
          postedOn: "2026-08-02",
          minor: -2000n,
        },
        {
          description: "Transfer To Jane Smith NetBank Rent Aug",
          postedOn: "2026-08-03",
          minor: -184000n,
        },
        {
          description: "Transfer To Jane Smith NetBank dinner split",
          postedOn: "2026-08-04",
          minor: -4000n,
        },
        { description: "Transfer To Pat Kim NetBank", postedOn: "2026-08-05", minor: -9000n },
      ]),
      importId: file.importId,
    });
    yield* enrich([
      { aliasKey: "WOOLWORTHS SYDNEY", name: "Woolworths" },
      { aliasKey: "WOOLWORTHS METRO SURRY HILLS", name: "Woolworths", confidence: 0.5 },
    ]);
    const jane = yield* createCounterparty({ name: "Jane Smith", kind: "person" }, ["JANE SMITH"]);
    yield* (yield* Counterparties).apply({
      commandId: CommandId.make(yield* Crypto.Crypto.use((crypto) => crypto.randomUUIDv4)),
      change: {
        kind: "saveReference",
        counterpartyId: jane.id,
        referenceKey: "rent",
        expectedVersion: null,
        defaultRole: "purchase",
        defaultCategoryId: yield* categoryId("housing.rent"),
      },
    });

    const postings = yield* Postings;
    const descriptions = (rows: readonly { description: string }[]) =>
      rows.map((row) => row.description).toSorted();
    const open = descriptions((yield* postings.ledger({ filter: { openQuestion: true } })).rows);
    expect(open).toEqual([
      "Transfer To Jane Smith NetBank dinner split",
      "Transfer To Pat Kim NetBank",
      "WOOLWORTHS METRO 77 SURRY HILLS Card xx1234",
    ]);
    const behind = yield* Effect.forEach(yield* openQuestions, (question) =>
      postings.ledger({ filter: { questionId: question.id } }),
    );
    expect(descriptions(behind.flatMap((page) => page.rows))).toEqual(open);
    const { rows } = yield* postings.ledger({ filter: {} });
    expect(descriptions(rows.filter((row) => row.question))).toEqual(open);
    expect(
      descriptions((yield* postings.ledger({ filter: { openQuestion: false } })).rows),
    ).toEqual(["Transfer To Jane Smith NetBank Rent Aug", "WOOLWORTHS 1234 SYDNEY AU Card xx1234"]);
  }).pipe(Effect.provide(services)),
);

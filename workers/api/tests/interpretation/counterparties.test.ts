import { PgClient } from "@effect/sql-pg";
import { CommandId } from "@repo/contracts/finance";
import { Crypto, Effect } from "effect";
import { expect } from "vitest";

import { Corrections } from "../../src/events/corrections.ts";
import { Events } from "../../src/events/service.ts";
import { Publication } from "../../src/imports/publication.ts";
import { Counterparties } from "../../src/interpretation/counterparties.ts";
import { Questions } from "../../src/interpretation/questions.ts";
import { Postings } from "../../src/postings/service.ts";
import { applicationTest } from "../support/application.ts";
import { account, parsed, parsedRows, reset, source } from "../support/fixtures.ts";

const { test, services } = applicationTest();
const commandId = Crypto.Crypto.use((crypto) => crypto.randomUUIDv4).pipe(
  Effect.map((id) => CommandId.make(id)),
);

const setup = Effect.gen(function* () {
  yield* reset;
  const owner = yield* account();
  const file = yield* source(owner.id);
  yield* (yield* Publication).publish({
    ...parsed([
      "WOOLWORTHS 1234 SYDNEY AU Card xx1234",
      "WOOLWORTHS 5678 SYDNEY AU Card xx1234",
      "Transfer To Jane Smith NetBank Rent",
      "Transfer to xx5678 CommBank app",
      "Transfer to xx9921 CommBank app",
    ]),
    importId: file.importId,
  });
  const events = yield* Events;
  const postings = (yield* (yield* Postings).list({ filter: {} })).rows;
  const event = Effect.fn(function* (description: string) {
    const posting = postings.find((row) => row.description === description);
    const found = posting ? yield* events.forPosting({ postingId: posting.id }) : null;
    if (!found) return yield* Effect.die(`Expected an event for ${description}`);
    return found;
  });
  const categories = (yield* events.references).categories;
  const category = (slug: string) => {
    const found = categories.find((row) => row.slug === slug);
    if (!found) throw new Error(`Expected category ${slug}`);
    return found.id;
  };
  return { owner, events, event, category };
});

test(
  "a counterparty default categorises every transaction from it except one you set by hand",
  Effect.gen(function* () {
    const { events, event, category } = yield* setup;
    const counterparties = yield* Counterparties;
    const woolworths = yield* counterparties.save({
      commandId: yield* commandId,
      target: { kind: "create", aliasKeys: ["WOOLWORTHS SYDNEY"] },
      fields: {
        name: "Woolworths",
        kind: "business",
        brand: null,
        defaultCategoryId: category("food.groceries"),
        defaultRole: null,
      },
    });
    const first = yield* event("WOOLWORTHS 1234 SYDNEY AU Card xx1234");
    const second = yield* event("WOOLWORTHS 5678 SYDNEY AU Card xx1234");
    for (const row of [first, second]) {
      expect(row).toMatchObject({ kind: "purchase", counterpartyId: woolworths.id });
      expect(row.allocations[0]).toMatchObject({
        categoryId: category("food.groceries"),
        categorySource: "counterparty",
      });
    }
    yield* (yield* Corrections).apply({
      commandId: yield* commandId,
      expectedVersions: [{ eventId: first.id, version: first.version }],
      change: {
        eventId: first.id,
        kind: "purchase",
        purchaseOn: null,
        allocations: [{ ...first.allocations[0], categoryId: category("shopping.gifts") }],
      },
    });
    yield* counterparties.save({
      commandId: yield* commandId,
      target: { kind: "update", id: woolworths.id, expectedVersion: woolworths.version },
      fields: {
        name: "Woolworths",
        kind: "business",
        brand: null,
        defaultCategoryId: category("shopping.home"),
        defaultRole: null,
      },
    });
    expect((yield* events.get({ eventId: first.id })).allocations[0]).toMatchObject({
      categoryId: category("shopping.gifts"),
      categorySource: "user",
    });
    expect((yield* events.get({ eventId: second.id })).allocations[0].categoryId).toBe(
      category("shopping.home"),
    );
  }).pipe(Effect.provide(services)),
);

test(
  "a payment to a person is a question until the person has a default, then it is spending",
  Effect.gen(function* () {
    const { event, category } = yield* setup;
    const questions = yield* Questions;
    const rent = yield* event("Transfer To Jane Smith NetBank Rent");
    expect(rent.kind).toBe("unresolved");
    expect(
      (yield* questions.list({ currency: "AUD" })).find((row) => row.aliasKey === "JANE SMITH"),
    ).toMatchObject({ kind: "unresolved", eventCount: 1 });
    const counterparties = yield* Counterparties;
    const jane = yield* counterparties.save({
      commandId: yield* commandId,
      target: { kind: "create", aliasKeys: ["JANE SMITH"] },
      fields: {
        name: "Jane Smith",
        kind: "person",
        brand: null,
        defaultCategoryId: null,
        defaultRole: null,
      },
    });
    expect(
      (yield* questions.list({ currency: "AUD" })).find((row) => row.counterparty?.id === jane.id),
    ).toMatchObject({ kind: "person" });
    yield* counterparties.save({
      commandId: yield* commandId,
      target: { kind: "update", id: jane.id, expectedVersion: jane.version },
      fields: {
        name: "Jane Smith",
        kind: "person",
        brand: null,
        defaultCategoryId: category("housing.rent"),
        defaultRole: "purchase",
      },
    });
    const answered = yield* event("Transfer To Jane Smith NetBank Rent");
    expect(answered).toMatchObject({ kind: "purchase", roleSource: "counterparty" });
    expect(answered.allocations[0].categoryId).toBe(category("housing.rent"));
    expect(
      (yield* questions.list({ currency: "AUD" })).some((row) => row.counterparty?.id === jane.id),
    ).toBe(false);
  }).pipe(Effect.provide(services)),
);

test(
  "a transfer to one of your accounts is a movement, and an unknown account is a question",
  Effect.gen(function* () {
    const { owner, events, event } = yield* setup;
    const sql = yield* PgClient.PgClient;
    yield* sql`UPDATE accounts SET account_number = '06200012345678' WHERE id = ${owner.id}`;
    yield* events.interpret({ commandId: yield* commandId });
    expect(yield* event("Transfer to xx5678 CommBank app")).toMatchObject({
      kind: "transfer",
      roleSource: "bank",
    });
    expect(
      (yield* (yield* Questions).list({ currency: "AUD" })).find(
        (row) => row.aliasKey === "ACCOUNT 9921",
      ),
    ).toMatchObject({ kind: "ownAccount", eventCount: 1 });
  }).pipe(Effect.provide(services)),
);

test(
  "the ledger and a counterparty's history read what each transaction was interpreted as",
  Effect.gen(function* () {
    yield* reset;
    const owner = yield* account();
    const file = yield* source(owner.id);
    yield* (yield* Publication).publish({
      ...parsedRows([
        {
          description: "WOOLWORTHS 1234 SYDNEY AU Card xx1234",
          postedOn: "2026-07-03",
          minor: -1000n,
        },
        {
          description: "WOOLWORTHS 1234 SYDNEY AU Card xx1234",
          postedOn: "2026-08-04",
          minor: -2500n,
        },
        {
          description: "WOOLWORTHS 5678 SYDNEY AU Card xx1234",
          postedOn: "2026-08-09",
          minor: 500n,
        },
        {
          description: "Transfer To Jane Smith NetBank Rent",
          postedOn: "2026-08-10",
          minor: -90000n,
        },
      ]),
      importId: file.importId,
    });
    const groceries = (yield* (yield* Events).references).categories.find(
      (row) => row.slug === "food.groceries",
    );
    if (!groceries) return yield* Effect.die("Expected the groceries category");
    const counterparties = yield* Counterparties;
    const woolworths = yield* counterparties.save({
      commandId: yield* commandId,
      target: { kind: "create", aliasKeys: ["WOOLWORTHS SYDNEY"] },
      fields: {
        name: "Woolworths",
        kind: "business",
        brand: null,
        defaultCategoryId: groceries.id,
        defaultRole: null,
      },
    });
    const ledger = yield* (yield* Postings).ledger({ filter: {} });
    expect(
      ledger.rows.map((row) => ({
        postedOn: row.postedOn,
        role: row.role,
        counterpartyName: row.counterpartyName,
        categorySlug: row.categorySlug,
        assignedBy: row.assignedBy,
        question: row.question,
      })),
    ).toEqual([
      {
        postedOn: "2026-08-10",
        role: "unresolved",
        counterpartyName: null,
        categorySlug: null,
        assignedBy: "none",
        question: true,
      },
      {
        postedOn: "2026-08-09",
        role: "refund",
        counterpartyName: "Woolworths",
        categorySlug: "food.groceries",
        assignedBy: "you",
        question: false,
      },
      {
        postedOn: "2026-08-04",
        role: "purchase",
        counterpartyName: "Woolworths",
        categorySlug: "food.groceries",
        assignedBy: "you",
        question: false,
      },
      {
        postedOn: "2026-07-03",
        role: "purchase",
        counterpartyName: "Woolworths",
        categorySlug: "food.groceries",
        assignedBy: "you",
        question: false,
      },
    ]);
    expect((yield* counterparties.get({ counterpartyId: woolworths.id })).months).toEqual([
      {
        month: "2026-07",
        outflow: { currency: "AUD", minor: 1000n },
        inflow: { currency: "AUD", minor: 0n },
      },
      {
        month: "2026-08",
        outflow: { currency: "AUD", minor: 2500n },
        inflow: { currency: "AUD", minor: 500n },
      },
    ]);
  }).pipe(Effect.provide(services)),
);

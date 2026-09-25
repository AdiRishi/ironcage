import { PgClient } from "@effect/sql-pg";
import { CalendarDate, CommandId, type FlowDirection } from "@repo/contracts/finance";
import { Crypto, Effect } from "effect";
import { expect } from "vitest";

import { Accounts } from "../../src/accounts/service.ts";
import { Corrections } from "../../src/events/corrections.ts";
import { Events } from "../../src/events/service.ts";
import { Publication } from "../../src/imports/publication.ts";
import { Counterparties } from "../../src/interpretation/counterparties.ts";
import { Questions } from "../../src/interpretation/questions.ts";
import { Postings } from "../../src/postings/service.ts";
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
    const woolworths = yield* createCounterparty(
      { name: "Woolworths", defaultCategoryId: category("food.groceries") },
      ["WOOLWORTHS SYDNEY"],
    );
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
    yield* updateCounterparty(woolworths, { defaultCategoryId: category("shopping.home") });
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
    const jane = yield* createCounterparty({ name: "Jane Smith", kind: "person" }, ["JANE SMITH"]);
    expect(
      (yield* questions.list({ currency: "AUD" })).find((row) => row.counterparty?.id === jane.id),
    ).toMatchObject({ kind: "person" });
    yield* updateCounterparty(jane, {
      defaultCategoryId: category("housing.rent"),
      defaultRole: "purchase",
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
          postedOn: "2026-06-03",
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
    const woolworths = yield* createCounterparty(
      { name: "Woolworths", defaultCategoryId: groceries.id },
      ["WOOLWORTHS SYDNEY"],
    );
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
        postedOn: "2026-06-03",
        role: "purchase",
        counterpartyName: "Woolworths",
        categorySlug: "food.groceries",
        assignedBy: "you",
        question: false,
      },
    ]);
    // The refund reduces August's spending, as it does on the overview, and July is
    // there with nothing in it. The file has no balances to reconcile, so every month
    // may have records missing.
    expect((yield* (yield* Counterparties).get({ counterpartyId: woolworths.id })).months).toEqual([
      {
        month: "2026-06",
        outflow: { currency: "AUD", minor: 1000n },
        inflow: { currency: "AUD", minor: 0n },
        coverage: "partial",
      },
      {
        month: "2026-07",
        outflow: { currency: "AUD", minor: 0n },
        inflow: { currency: "AUD", minor: 0n },
        coverage: "partial",
      },
      {
        month: "2026-08",
        outflow: { currency: "AUD", minor: 2000n },
        inflow: { currency: "AUD", minor: 0n },
        coverage: "partial",
      },
    ]);
  }).pipe(Effect.provide(services)),
);

test(
  "searching descriptors finds the text the bank printed or the name of who holds it",
  Effect.gen(function* () {
    yield* reset;
    const owner = yield* account();
    const file = yield* source(owner.id);
    yield* (yield* Publication).publish({
      ...parsed([
        "WOOLWORTHS 1234 SYDNEY AU Card xx1234",
        "WOOLWORTHS 5678 SYDNEY AU Card xx1234",
        "WOOLWORTHS METRO 77 SURRY HILLS Card xx1234",
        "COLES 0456 NEWTOWN AU Card xx1234",
        "COLES EXPRESS 22 MASCOT AU Card xx1234",
        "CALTEX 12 MASCOT AU Card xx1234",
      ]),
      importId: file.importId,
    });
    const woolworths = yield* createCounterparty({ name: "Woolworths" }, ["WOOLWORTHS SYDNEY"]);
    // Coles also holds a descriptor whose text does not say Coles.
    const coles = yield* createCounterparty({ name: "Coles" }, [
      "COLES NEWTOWN",
      "COLES EXPRESS MASCOT",
      "CALTEX MASCOT",
    ]);
    const counterparties = yield* Counterparties;
    // The alias key drops the digits, so only the printed text has 5678.
    expect(
      yield* counterparties.searchDescriptors({ search: "5678", excludeCounterpartyId: null }),
    ).toEqual([
      {
        aliasKey: "WOOLWORTHS SYDNEY",
        samples: ["WOOLWORTHS 1234 SYDNEY AU", "WOOLWORTHS 5678 SYDNEY AU"],
        eventCount: 2,
        alias: {
          counterpartyId: woolworths.id,
          counterpartyName: "Woolworths",
          status: "applied",
          source: "user",
          version: 1,
        },
      },
    ]);
    const held = (search: string) =>
      counterparties
        .searchDescriptors({ search, excludeCounterpartyId: woolworths.id })
        .pipe(
          Effect.map((matches) =>
            matches.map((match) => [match.aliasKey, match.alias?.counterpartyId ?? null]),
          ),
        );
    expect(yield* held("coles")).toEqual([
      ["CALTEX MASCOT", coles.id],
      ["COLES EXPRESS MASCOT", coles.id],
      ["COLES NEWTOWN", coles.id],
    ]);
    // Woolworths's own descriptor is left out; the unclaimed one is offered.
    expect(yield* held("Woolworths")).toEqual([["WOOLWORTHS METRO SURRY HILLS", null]]);
    expect(yield* held("%")).toEqual([]);
  }).pipe(Effect.provide(services)),
);

test(
  "the counterparty list counts each tab's own transactions, lists a refund-only counterparty last, and matches descriptor text",
  Effect.gen(function* () {
    yield* reset;
    const owner = yield* account();
    const file = yield* source(owner.id);
    yield* (yield* Publication).publish({
      ...parsedRows([
        { description: "Salary ACME PTY LTD HR123456", postedOn: "2026-08-01", minor: 500000n },
        { description: "Refund Purchase MYER SYDNEY", postedOn: "2026-08-02", minor: 4000n },
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
          description: "WOOLWORTHS 1234 SYDNEY AU Card xx1234",
          postedOn: "2026-08-12",
          minor: -1000n,
        },
      ]),
      importId: file.importId,
    });
    const categories = (yield* (yield* Events).references).categories;
    const category = (slug: string) => categories.find((row) => row.slug === slug)?.id ?? null;
    yield* createCounterparty({ name: "Acme", kind: "institution" }, ["ACME PTY LTD"]);
    yield* createCounterparty({ name: "Myer", defaultCategoryId: category("shopping.clothing") }, [
      "MYER SYDNEY",
    ]);
    yield* createCounterparty(
      { name: "Woolworths", defaultCategoryId: category("food.groceries") },
      ["WOOLWORTHS SYDNEY"],
    );
    const list = (direction: FlowDirection, search = "") =>
      Counterparties.use((counterparties) =>
        counterparties.list({
          search,
          currency: "AUD",
          period: {
            start: CalendarDate.make("2026-08-01"),
            endExclusive: CalendarDate.make("2026-09-01"),
          },
          direction,
        }),
      ).pipe(
        Effect.map((rows) =>
          rows.map((row) => [
            row.name,
            direction === "out" ? row.outflow.minor : row.inflow.minor,
            direction === "out" ? row.outflowEvents : row.inflowEvents,
          ]),
        ),
      );
    // Two purchases less a refund, and a refund with no purchase in the period.
    expect(yield* list("out")).toEqual([
      ["Woolworths", 3000n, 3],
      ["Myer", -4000n, 1],
    ]);
    expect(yield* list("in")).toEqual([["Acme", 500000n, 1]]);
    expect(yield* list("out", "1234")).toEqual([["Woolworths", 3000n, 3]]);
    expect(yield* list("out", "_")).toEqual([]);
  }).pipe(Effect.provide(services)),
);

test(
  "a counterparty's months say where the accounts it is paid from have no records instead of showing zero",
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
    const publish = Effect.fn(function* (
      owner: { id: typeof everyday.id },
      row: { description: string; postedOn: string; minor: bigint },
    ) {
      const file = yield* source(owner.id);
      yield* publication.publish({ ...parsedRows([row]), importId: file.importId });
    });
    // July's and September's records for the everyday account, and August's only for a
    // card that Woolworths is never paid from.
    yield* publish(everyday, {
      description: "WOOLWORTHS 1234 SYDNEY AU Card xx1234",
      postedOn: "2026-07-03",
      minor: -4200n,
    });
    yield* publish(everyday, {
      description: "WOOLWORTHS 5678 SYDNEY AU Card xx1234",
      postedOn: "2026-09-05",
      minor: -1500n,
    });
    yield* publish(card, {
      description: "BIG SHOP SYDNEY AU",
      postedOn: "2026-08-10",
      minor: -1000n,
    });
    const woolworths = yield* createCounterparty({ name: "Woolworths" }, ["WOOLWORTHS SYDNEY"]);
    const { months } = yield* (yield* Counterparties).get({ counterpartyId: woolworths.id });
    expect(months.map((month) => [month.month, month.outflow.minor, month.coverage])).toEqual([
      ["2026-07", 4200n, "partial"],
      ["2026-08", 0n, "missing"],
      ["2026-09", 1500n, "partial"],
    ]);
  }).pipe(Effect.provide(services)),
);

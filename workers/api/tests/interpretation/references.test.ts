import { PgClient } from "@effect/sql-pg";
import { CategoryId, CommandId } from "@repo/contracts/finance";
import { Crypto, Effect, Schema, Struct } from "effect";
import { expect } from "vitest";

import { Publication } from "../../src/imports/publication.ts";
import { Counterparties } from "../../src/interpretation/counterparties.ts";
import { applicationTest } from "../support/application.ts";
import {
  account,
  createCounterparty,
  enrich,
  openQuestions,
  parsedRows,
  reset,
  source,
  updateCounterparty,
} from "../support/fixtures.ts";
import { counterpartyNamed } from "../support/populated.ts";

const { test, services } = applicationTest();
const commandId = Crypto.Crypto.use((crypto) => crypto.randomUUIDv4).pipe(
  Effect.map((id) => CommandId.make(id)),
);
const category = Effect.fn(function* (slug: string) {
  const sql = yield* PgClient.PgClient;
  const [row] = yield* sql`SELECT id FROM categories WHERE slug = ${slug}`.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ id: CategoryId })))),
  );
  if (!row) return yield* Effect.die(`Expected category ${slug}`);
  return row.id;
});
const spendingBySlug = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;
  const rows = yield* sql`SELECT c.slug, sum(f.amount_minor)::text AS total FROM ledger_facts f
      LEFT JOIN categories c ON c.id = f.category_id WHERE f.measure = 'spending' GROUP BY c.slug ORDER BY 1`;
  return Object.fromEntries(rows.map((row) => [String(row.slug), String(row.total)]));
});

test(
  "rent and a bill split paid to one person are asked about and categorised by reference",
  Effect.gen(function* () {
    yield* reset;
    const owner = yield* account();
    const file = yield* source(owner.id);
    yield* (yield* Publication).publish({
      ...parsedRows([
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
      ]),
      importId: file.importId,
    });
    const counterparties = yield* Counterparties;
    const jane = yield* createCounterparty({ name: "Jane Smith", kind: "person" }, ["JANE SMITH"]);
    const questions = Effect.map(openQuestions, (rows) =>
      rows.flatMap((question) =>
        question.kind === "person" ? [[question.reference?.key, question.affects.eventCount]] : [],
      ),
    );
    expect(yield* questions).toEqual([
      ["rent", 2],
      ["dinner split", 1],
    ]);

    yield* counterparties.apply({
      commandId: yield* commandId,
      change: {
        kind: "saveReference",
        counterpartyId: jane.id,
        referenceKey: "rent",
        expectedVersion: null,
        defaultRole: "purchase",
        defaultCategoryId: yield* category("housing.rent"),
      },
    });
    expect(yield* questions).toEqual([["dinner split", 1]]);
    expect(yield* spendingBySlug).toEqual({ "housing.rent": "368000" });

    // Her own default covers the rest, and the reference still outranks it.
    yield* updateCounterparty(
      (yield* counterparties.get({ counterpartyId: jane.id })).counterparty,
      {
        defaultCategoryId: yield* category("food.dining-out"),
        defaultRole: "purchase",
      },
    );
    expect(yield* questions).toEqual([]);
    expect(yield* spendingBySlug).toEqual({ "food.dining-out": "4000", "housing.rent": "368000" });
    expect(
      (yield* counterparties.get({ counterpartyId: jane.id })).references.map((row) => [
        row.referenceKey,
        row.eventCount,
        row.defaultRole,
        row.version,
      ]),
    ).toEqual([
      ["rent", 2, "purchase", 1],
      ["dinner split", 1, null, null],
    ]);

    yield* counterparties.apply({
      commandId: yield* commandId,
      change: {
        kind: "deleteReference",
        counterpartyId: jane.id,
        referenceKey: "rent",
        expectedVersion: 1,
      },
    });
    expect(yield* spendingBySlug).toEqual({ "food.dining-out": "372000" });
  }).pipe(Effect.provide(services)),
);

test(
  "a reference default applies while the model's counterparty waits for an answer",
  Effect.gen(function* () {
    yield* reset;
    const owner = yield* account();
    const file = yield* source(owner.id);
    yield* (yield* Publication).publish({
      ...parsedRows([
        { description: "Transfer To ATO NetBank tax", postedOn: "2026-08-20", minor: -250000n },
      ]),
      importId: file.importId,
    });
    yield* enrich([{ aliasKey: "ATO", name: "ATO", kind: "institution", confidence: 0.4 }]);
    const ato = yield* counterpartyNamed("ATO");
    expect(ato.status).toBe("proposed");
    yield* (yield* Counterparties).apply({
      commandId: yield* commandId,
      change: {
        kind: "saveReference",
        counterpartyId: ato.id,
        referenceKey: "tax",
        expectedVersion: null,
        defaultRole: "purchase",
        defaultCategoryId: yield* category("government.tax"),
      },
    });
    expect(yield* spendingBySlug).toEqual({ "government.tax": "250000" });
  }).pipe(Effect.provide(services)),
);

test(
  "payments to a person cannot be transfers, by default or for a reference",
  Effect.gen(function* () {
    yield* reset;
    const owner = yield* account();
    const file = yield* source(owner.id);
    yield* (yield* Publication).publish({
      ...parsedRows([
        {
          description: "Transfer To Jane Smith NetBank savings",
          postedOn: "2026-08-20",
          minor: -50000n,
        },
      ]),
      importId: file.importId,
    });
    const jane = yield* createCounterparty({ name: "Jane Smith", kind: "person" }, ["JANE SMITH"]);
    const failure = yield* (yield* Counterparties)
      .apply({
        commandId: yield* commandId,
        change: {
          kind: "saveReference",
          counterpartyId: jane.id,
          referenceKey: "savings",
          expectedVersion: null,
          defaultRole: "transfer",
          defaultCategoryId: null,
        },
      })
      .pipe(Effect.flip);
    expect(failure.kind).toBe("invalid");
    expect(
      (yield* (yield* Counterparties).get({ counterpartyId: jane.id })).references,
    ).toMatchObject([{ referenceKey: "savings", defaultRole: null, version: null }]);
    const updated = yield* (yield* Counterparties)
      .apply({
        commandId: yield* commandId,
        change: {
          kind: "update",
          counterpartyId: jane.id,
          expectedVersion: jane.version,
          fields: {
            ...Struct.pick(jane, ["name", "kind", "brand", "defaultCategoryId"]),
            defaultRole: "transfer",
          },
        },
      })
      .pipe(Effect.flip);
    expect(updated.kind).toBe("invalid");
    expect(yield* counterpartyNamed("Jane Smith")).toMatchObject({ defaultRole: null });
  }).pipe(Effect.provide(services)),
);

import { PgClient } from "@effect/sql-pg";
import { CategoryId, CommandId } from "@repo/contracts/finance";
import { Crypto, Effect, Schema } from "effect";
import { expect } from "vitest";

import { Publication } from "../../src/imports/publication.ts";
import { Counterparties } from "../../src/interpretation/counterparties.ts";
import { Questions } from "../../src/interpretation/questions.ts";
import { applicationTest } from "../support/application.ts";
import {
  account,
  createCounterparty,
  parsedRows,
  reset,
  source,
  updateCounterparty,
} from "../support/fixtures.ts";

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
    const questions = Effect.gen(function* () {
      const list = yield* (yield* Questions).list({ currency: "AUD" });
      return list
        .filter((question) => question.kind === "person")
        .map((question) => [question.reference?.key, question.eventCount]);
    });
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

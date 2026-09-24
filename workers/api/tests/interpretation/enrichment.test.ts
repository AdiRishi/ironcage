import { PgClient } from "@effect/sql-pg";
import { CommandId, type EnrichmentResult } from "@repo/contracts/finance";
import { Crypto, Effect } from "effect";
import { expect } from "vitest";

import { Events } from "../../src/events/service.ts";
import { Publication } from "../../src/imports/publication.ts";
import { Enrichment } from "../../src/interpretation/enrichment.ts";
import { Questions } from "../../src/interpretation/questions.ts";
import { Postings } from "../../src/postings/service.ts";
import { applicationTest } from "../support/application.ts";
import { account, parsed, reset, source } from "../support/fixtures.ts";

const { test, services } = applicationTest();
const commandId = Crypto.Crypto.use((crypto) => crypto.randomUUIDv4).pipe(
  Effect.map((id) => CommandId.make(id)),
);
const result = (fields: Partial<EnrichmentResult> & Pick<EnrichmentResult, "aliasKey" | "name">) =>
  ({
    existingCounterpartyId: null,
    kind: "business",
    brand: null,
    categoryKey: null,
    defaultRole: null,
    confidence: 0.95,
    reason: "Synthetic reason.",
    proposedSubcategory: null,
    ...fields,
  }) satisfies EnrichmentResult;

const setup = Effect.gen(function* () {
  yield* reset;
  const owner = yield* account();
  const file = yield* source(owner.id);
  yield* (yield* Publication).publish({
    ...parsed([
      "WOOLWORTHS 1234 SYDNEY AU Card xx1234",
      "WOOLWORTHS METRO 77 SURRY HILLS Card xx1234",
      "SQ *NEW CAFE 0412 Card xx1234",
      "Transfer To Jane Smith NetBank Rent",
    ]),
    importId: file.importId,
  });
  const enrichment = yield* Enrichment;
  const run = yield* enrichment.request({ commandId: yield* commandId });
  const batch = yield* enrichment.batch({ runId: run.id });
  const events = yield* Events;
  const rows = (yield* (yield* Postings).list({ filter: {} })).rows;
  const event = Effect.fn(function* (description: string) {
    const posting = rows.find((row) => row.description === description);
    const found = posting ? yield* events.forPosting({ postingId: posting.id }) : null;
    if (!found) return yield* Effect.die(`Expected an event for ${description}`);
    return found;
  });
  const complete = Effect.fn(function* (results: EnrichmentResult[]) {
    return yield* enrichment.complete({
      commandId: yield* commandId,
      runId: run.id,
      aliasKeys: batch.aliases.map((alias) => alias.aliasKey),
      report: {
        status: "success",
        results,
        inputTokens: 1000n,
        outputTokens: 200n,
        searches: 1,
        cost: { currency: "USD", minor: 2n },
        failure: null,
      },
    });
  });
  return { enrichment, run, batch, event, complete };
});

test(
  "the model sees descriptor text without amounts, and every unmapped alias is requested once",
  Effect.gen(function* () {
    const { run, batch } = yield* setup;
    expect(run.requested).toBe(4);
    expect(batch.aliases.map((alias) => alias.aliasKey).toSorted()).toEqual([
      "JANE SMITH",
      "SQ NEW CAFE",
      "WOOLWORTHS METRO SURRY HILLS",
      "WOOLWORTHS SYDNEY",
    ]);
    expect(JSON.stringify(batch.aliases)).not.toMatch(/450|xx1234|Rent/);
    expect(batch.categories.some((category) => category.key === "food.groceries")).toBe(true);
  }).pipe(Effect.provide(services)),
);

test(
  "confident answers apply at once, uncertain ones and people become questions, and one business keeps one counterparty",
  Effect.gen(function* () {
    const { event, complete } = yield* setup;
    yield* complete([
      result({ aliasKey: "WOOLWORTHS SYDNEY", name: "Woolworths", categoryKey: "food.groceries" }),
      result({
        aliasKey: "WOOLWORTHS METRO SURRY HILLS",
        name: "Woolworths",
        categoryKey: "food.groceries",
      }),
      result({
        aliasKey: "SQ NEW CAFE",
        name: "New Cafe",
        categoryKey: "food.coffee",
        confidence: 0.4,
      }),
      result({
        aliasKey: "JANE SMITH",
        name: "Jane Smith",
        kind: "person",
        categoryKey: "housing.rent",
        defaultRole: "purchase",
        confidence: 0.7,
        proposedSubcategory: { parentKey: "housing", name: "Room rent" },
      }),
    ]);
    const first = yield* event("WOOLWORTHS 1234 SYDNEY AU Card xx1234");
    const second = yield* event("WOOLWORTHS METRO 77 SURRY HILLS Card xx1234");
    expect(first.counterpartyId).not.toBeNull();
    expect(second.counterpartyId).toBe(first.counterpartyId);
    expect(first.allocations[0]).toMatchObject({ categorySource: "counterparty" });
    expect((yield* event("SQ *NEW CAFE 0412 Card xx1234")).allocations[0].categoryId).toBeNull();
    expect((yield* event("Transfer To Jane Smith NetBank Rent")).kind).toBe("unresolved");
    const questions = yield* (yield* Questions).list({ currency: "AUD" });
    expect(
      questions
        .toSorted((a, b) => a.kind.localeCompare(b.kind))
        .map((question) => [question.kind, question.counterparty?.name]),
    ).toEqual([
      ["counterparty", "New Cafe"],
      ["person", "Jane Smith"],
    ]);
    expect((yield* (yield* Enrichment).proposals).map((row) => [row.parentName, row.name])).toEqual(
      [["Housing", "Room rent"]],
    );
  }).pipe(Effect.provide(services)),
);

test(
  "a failed batch records its usage, fails the run, and leaves its aliases for another run",
  Effect.gen(function* () {
    const { enrichment, run, batch } = yield* setup;
    yield* enrichment.complete({
      commandId: yield* commandId,
      runId: run.id,
      aliasKeys: batch.aliases.map((alias) => alias.aliasKey),
      report: {
        status: "failed",
        results: [],
        inputTokens: null,
        outputTokens: null,
        searches: 0,
        cost: null,
        failure: "The model declined this batch. Its aliases stay unresolved.",
      },
    });
    expect((yield* enrichment.runs)[0]).toMatchObject({ status: "failed", resolved: 0 });
    const sql = yield* PgClient.PgClient;
    expect(yield* sql`SELECT task, status, input_tokens AS "inputTokens" FROM model_usage`).toEqual(
      [{ task: "enrichment", status: "failed", inputTokens: null }],
    );
    expect((yield* enrichment.request({ commandId: yield* commandId })).requested).toBe(4);
  }).pipe(Effect.provide(services)),
);

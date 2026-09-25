import { PgClient } from "@effect/sql-pg";
import { CommandId, type EnrichmentResult } from "@repo/contracts/finance";
import { Crypto, Effect, Layer } from "effect";
import { expect } from "vitest";

import { Events } from "../../src/events/service.ts";
import { Publication } from "../../src/imports/publication.ts";
import { Counterparties } from "../../src/interpretation/counterparties.ts";
import { CounterpartyHistory } from "../../src/interpretation/counterparty-history.ts";
import { Enrichment } from "../../src/interpretation/enrichment.ts";
import { Questions } from "../../src/interpretation/questions.ts";
import { EnrichmentConfig, EnrichmentJobs } from "../../src/platform/services.ts";
import { Postings } from "../../src/postings/service.ts";
import { applicationTest } from "../support/application.ts";
import { account, createCounterparty, parsed, reset, source } from "../support/fixtures.ts";

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
  "an uncertain answer that names an existing counterparty asks before linking its descriptor",
  Effect.gen(function* () {
    const { event, complete } = yield* setup;
    yield* complete([
      result({ aliasKey: "WOOLWORTHS SYDNEY", name: "Woolworths", categoryKey: "food.groceries" }),
      result({
        aliasKey: "WOOLWORTHS METRO SURRY HILLS",
        name: "Woolworths",
        categoryKey: "food.groceries",
        confidence: 0.5,
        reason: "Probably the same supermarket chain.",
      }),
    ]);
    const known = yield* event("WOOLWORTHS 1234 SYDNEY AU Card xx1234");
    const uncertain = yield* event("WOOLWORTHS METRO 77 SURRY HILLS Card xx1234");
    expect(known.counterpartyId).not.toBeNull();
    expect(uncertain.counterpartyId).toBeNull();
    expect(uncertain.allocations[0]?.categoryId).toBeNull();
    const question = (yield* (yield* Questions).list({ currency: "AUD" })).find(
      (row) => row.kind === "alias",
    );
    expect(question).toMatchObject({
      aliasKey: "WOOLWORTHS METRO SURRY HILLS",
      counterparty: { id: known.counterpartyId, name: "Woolworths" },
      proposal: { confidence: 0.5, reason: "Probably the same supermarket chain." },
      eventCount: 1,
    });
    if (!question || !known.counterpartyId) return yield* Effect.die("Expected the question");
    yield* (yield* Counterparties).apply({
      commandId: yield* commandId,
      change: {
        kind: "moveAlias",
        aliasKey: "WOOLWORTHS METRO SURRY HILLS",
        expectedVersion: question.aliasVersion,
        counterpartyId: known.counterpartyId,
        event: null,
      },
    });
    const confirmed = yield* event("WOOLWORTHS METRO 77 SURRY HILLS Card xx1234");
    expect(confirmed.counterpartyId).toBe(known.counterpartyId);
    expect(confirmed.allocations[0]?.categoryId).toBe(known.allocations[0]?.categoryId);
    expect(
      (yield* (yield* Questions).list({ currency: "AUD" })).some((row) => row.kind === "alias"),
    ).toBe(false);
  }).pipe(Effect.provide(services)),
);

test(
  "accepting a suggested subcategory moves the model's counterparty and its transactions into it",
  Effect.gen(function* () {
    const { enrichment, event, complete } = yield* setup;
    yield* complete([
      result({
        aliasKey: "WOOLWORTHS SYDNEY",
        name: "Woolworths",
        categoryKey: "food.groceries",
        proposedSubcategory: { parentKey: "food", name: "Supermarkets" },
      }),
    ]);
    const [proposal] = yield* enrichment.proposals;
    if (!proposal) return yield* Effect.die("Expected a suggested subcategory");
    expect(proposal.counterparties.map((row) => row.name)).toEqual(["Woolworths"]);
    const outcome = yield* enrichment.resolveProposal({
      commandId: yield* commandId,
      proposalId: proposal.id,
      decision: "accept",
    });
    expect(outcome.moved).toBe(1);
    const categories = (yield* (yield* Events).references).categories;
    expect(categories.find((row) => row.id === outcome.categoryId)).toMatchObject({
      name: "Supermarkets",
      parentId: categories.find((row) => row.slug === "food")?.id,
      tree: "spending",
    });
    expect((yield* event("WOOLWORTHS 1234 SYDNEY AU Card xx1234")).allocations[0]).toMatchObject({
      categoryId: outcome.categoryId,
      categorySource: "counterparty",
    });
    expect(yield* enrichment.proposals).toEqual([]);
    const woolworths = (yield* event("WOOLWORTHS 1234 SYDNEY AU Card xx1234")).counterpartyId;
    if (!woolworths) return yield* Effect.die("Expected Woolworths");
    const history = yield* CounterpartyHistory;
    const [accepted] = (yield* history.list({ counterpartyId: woolworths })).rows;
    if (!accepted) return yield* Effect.die("Expected the acceptance in history");
    expect(accepted).toMatchObject({
      kind: "acceptCategory",
      subjects: [{ id: woolworths, name: "Woolworths" }],
      eventCount: 1,
      undoable: true,
    });
    yield* history.undo({ commandId: yield* commandId, changeId: accepted.id });
    expect((yield* event("WOOLWORTHS 1234 SYDNEY AU Card xx1234")).allocations[0]).toMatchObject({
      categoryId: categories.find((row) => row.slug === "food.groceries")?.id,
      categorySource: "counterparty",
    });
    const again = yield* enrichment
      .resolveProposal({
        commandId: yield* commandId,
        proposalId: proposal.id,
        decision: "dismiss",
      })
      .pipe(Effect.result);
    expect(again._tag === "Failure" && again.failure.kind).toBe("stale");
  }).pipe(Effect.provide(services)),
);

test(
  "a failed batch records its usage and leaves its aliases for a later run while this one goes on",
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
        cost: null,
        failure: "The model declined this batch. Its aliases stay unresolved.",
      },
    });
    expect((yield* enrichment.runs)[0]).toMatchObject({
      status: "running",
      failed: 4,
      failure: "The model declined this batch. Its aliases stay unresolved.",
    });
    expect((yield* enrichment.batch({ runId: run.id })).aliases).toEqual([]);
    expect((yield* enrichment.runs)[0]).toMatchObject({
      status: "completed",
      resolved: 0,
      failed: 4,
    });
    const sql = yield* PgClient.PgClient;
    expect(yield* sql`SELECT task, status, input_tokens AS "inputTokens" FROM model_usage`).toEqual(
      [{ task: "enrichment", status: "failed", inputTokens: null }],
    );
    expect((yield* enrichment.request({ commandId: yield* commandId })).requested).toBe(4);
  }).pipe(Effect.provide(services)),
);

test(
  "a run whose Workflow stopped is marked failed, and a new run picks up its aliases",
  Effect.gen(function* () {
    const { enrichment, run } = yield* setup;
    const stopped = yield* Enrichment.pipe(
      Effect.provide(
        Layer.fresh(Enrichment.layer).pipe(
          Layer.provide([
            Layer.succeed(EnrichmentJobs, {
              start: () => Effect.void,
              status: () => Effect.succeed({ status: "errored", failure: "Worker restarted." }),
            }),
            Layer.succeed(EnrichmentConfig, {
              provider: yield* enrichment.settings.pipe(Effect.map((row) => row.provider)),
            }),
          ]),
        ),
      ),
    );
    expect((yield* stopped.runs).find((row) => row.id === run.id)).toMatchObject({
      status: "failed",
      failure: "Worker restarted.",
    });
    expect((yield* enrichment.request({ commandId: yield* commandId })).requested).toBe(4);
  }).pipe(Effect.provide(services)),
);

test(
  "a second run cannot start while one is still working",
  Effect.gen(function* () {
    const { enrichment } = yield* setup;
    const second = yield* enrichment.request({ commandId: yield* commandId }).pipe(Effect.result);
    expect(second._tag === "Failure" && second.failure.kind).toBe("conflict");
  }).pipe(Effect.provide(services)),
);

test(
  "a check against your answers hides them from the model and scores its replies without applying them",
  Effect.gen(function* () {
    yield* reset;
    const owner = yield* account();
    const file = yield* source(owner.id);
    yield* (yield* Publication).publish({
      ...parsed(["WOOLWORTHS 1234 SYDNEY AU Card xx1234", "SQ *NEW CAFE 0412 Card xx1234"]),
      importId: file.importId,
    });
    const groceries = (yield* (yield* Events).references).categories.find(
      (row) => row.slug === "food.groceries",
    );
    const coffee = (yield* (yield* Events).references).categories.find(
      (row) => row.slug === "food.coffee",
    );
    if (!groceries || !coffee) return yield* Effect.die("Expected seeded categories");
    for (const [aliasKey, name, categoryId] of [
      ["WOOLWORTHS SYDNEY", "Woolworths", groceries.id],
      ["SQ NEW CAFE", "New Cafe", coffee.id],
    ] as const)
      yield* createCounterparty({ name, defaultCategoryId: categoryId }, [aliasKey]);
    const enrichment = yield* Enrichment;
    const run = yield* enrichment.evaluate({ commandId: yield* commandId });
    expect(run).toMatchObject({ purpose: "evaluate", requested: 2 });
    const batch = yield* enrichment.batch({ runId: run.id });
    expect(batch.aliases.map((alias) => alias.aliasKey).toSorted()).toEqual([
      "SQ NEW CAFE",
      "WOOLWORTHS SYDNEY",
    ]);
    expect(batch.counterparties).toEqual([]);
    expect(batch.examples).toEqual([]);
    yield* enrichment.complete({
      commandId: yield* commandId,
      runId: run.id,
      aliasKeys: batch.aliases.map((alias) => alias.aliasKey),
      report: {
        status: "success",
        results: [
          result({
            aliasKey: "WOOLWORTHS SYDNEY",
            name: "WOOLWORTHS",
            categoryKey: "food.groceries",
          }),
          result({
            aliasKey: "SQ NEW CAFE",
            name: "New Cafe",
            categoryKey: "food.dining-out",
            confidence: 0.6,
          }),
        ],
        inputTokens: 1000n,
        outputTokens: 200n,
        cost: { currency: "USD", minor: 2n },
        failure: null,
      },
    });
    const [checked] = yield* enrichment.runs;
    expect(checked?.evaluation).toMatchObject({
      asked: 2,
      answered: 2,
      name: 2,
      category: 1,
      topCategory: 2,
      confident: 1,
      confidentRight: 1,
    });
    const [cafe] = yield* (yield* Counterparties).list({
      search: "Cafe",
      currency: "AUD",
      period: null,
      direction: "out",
    });
    expect(cafe?.defaultCategoryId).toBe(coffee.id);
  }).pipe(Effect.provide(services)),
);

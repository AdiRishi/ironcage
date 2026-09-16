import { CategoryId, CommandId, type ClassificationReport } from "@repo/contracts/finance";
import { Crypto, Effect, Layer } from "effect";
import { expect } from "vitest";

import { Classification } from "../../src/classification/service.ts";
import { Corrections } from "../../src/events/corrections.ts";
import { Events } from "../../src/events/service.ts";
import { Publication } from "../../src/imports/publication.ts";
import { Models } from "../../src/models/service.ts";
import { Postings } from "../../src/postings/service.ts";
import { applicationTest } from "../support/application.ts";
import { account, parsed, reset, source } from "../support/fixtures.ts";
const { test, services } = applicationTest();
const commandId = Crypto.Crypto.use((crypto) => crypto.randomUUIDv4).pipe(
  Effect.map((id) => CommandId.make(id)),
);
const groceries = CategoryId.make("00000000-0000-4000-8000-000000000001");
const household = CategoryId.make("00000000-0000-4000-8000-000000000002");
const setup = Effect.gen(function* () {
  yield* reset;
  const owner = yield* account();
  const file = yield* source(owner.id);
  const publication = yield* Publication;
  yield* publication.publish({
    ...parsed(["Synthetic groceries Card xx1234", "Synthetic household Card xx1234"]),
    importId: file.importId,
  });
  const events = yield* Events;
  yield* events.interpret({ commandId: yield* commandId, scope: "all" });
  const postings = yield* Postings;
  const rows = yield* Effect.forEach((yield* postings.list({ filter: {} })).rows, (posting) =>
    Effect.gen(function* () {
      const event = yield* events.forPosting({ postingId: posting.id });
      if (!event) return yield* Effect.die("Expected event");
      return event;
    }),
  );
  const classification = yield* Classification;
  return { events, rows, classification };
});
test(
  "classification is optional, respects concurrent corrections, and acceptance preserves bank fields and precedence",
  Effect.gen(function* () {
    const { events, rows, classification } = yield* setup;
    const disabled = yield* classification
      .request({ commandId: yield* commandId, eventIds: "all" })
      .pipe(Effect.result);
    expect(disabled._tag === "Failure" && disabled.failure.kind).toBe("unavailable");
    yield* classification.configure({
      commandId: yield* commandId,
      enabled: true,
      warning: { currency: "USD", minor: 500n },
      expectedVersion: 1,
    });
    const run = yield* classification.request({ commandId: yield* commandId, eventIds: "all" });
    expect(run.requested).toBe(2);
    const batch = yield* classification.batch({ runId: run.id });
    const corrected = rows[0];
    if (!corrected) return yield* Effect.die("Expected event");
    const corrections = yield* Corrections;
    yield* corrections.apply({
      commandId: yield* commandId,
      expectedVersions: [{ eventId: corrected.id, version: corrected.version }],
      change: {
        eventId: corrected.id,
        kind: corrected.kind,
        purchaseOn: null,
        allocations: [{ ...corrected.allocations[0], categoryId: household }],
      },
    });
    const report: typeof ClassificationReport.Type = {
      status: "success",
      results: batch.items.map((item) => ({
        eventId: item.eventId,
        categoryId: groceries,
        reason: "Synthetic grocery description.",
      })),
      inputTokens: 100n,
      outputTokens: 40n,
      cost: { currency: "USD", minor: 1n },
      failure: null,
    };
    const complete = {
      commandId: batch.commandId,
      runId: run.id,
      expectedVersions: batch.items.map((item) => ({
        eventId: item.eventId,
        version: item.eventVersion,
      })),
      report,
    };
    yield* classification.complete(complete);
    yield* classification.complete(complete);
    const usage = yield* (yield* Models).get;
    expect(usage.calls).toBe(1);
    expect(usage.costs).toEqual([{ currency: "USD", minor: 1n }]);
    const suggestions = yield* classification.suggestions;
    expect(suggestions).toHaveLength(1);
    const suggestion = suggestions[0];
    if (!suggestion) return yield* Effect.die("Expected suggestion");
    const before = yield* events.get({ eventId: suggestion.eventId });
    expect(before.allocations[0].categoryId).toBeNull();
    const result = yield* classification.accept({
      commandId: yield* commandId,
      expectedVersions: [
        { eventId: suggestion.eventId, version: suggestion.suggestion.eventVersion },
        { eventId: corrected.id, version: corrected.version },
      ],
    });
    expect(result).toEqual({ accepted: 1, skipped: 1 });
    expect((yield* events.get({ eventId: suggestion.eventId })).postings).toEqual(before.postings);
    expect((yield* events.get({ eventId: corrected.id })).allocations[0].categoryId).toBe(
      household,
    );
    const rerun = yield* classification.request({ commandId: yield* commandId, eventIds: "all" });
    expect(rerun.requested).toBe(0);
    expect((yield* classification.runs).find((row) => row.id === run.id)?.status).toBe("completed");
  }).pipe(Effect.provide(Models.layer.pipe(Layer.provideMerge(services)))),
);
test(
  "failed classification retains unknown usage, blocks at the observed threshold, and leaves manual correction available",
  Effect.gen(function* () {
    const { rows, classification } = yield* setup;
    yield* classification.configure({
      commandId: yield* commandId,
      enabled: true,
      warning: { currency: "USD", minor: 1n },
      expectedVersion: 1,
    });
    const run = yield* classification.request({ commandId: yield* commandId, eventIds: "all" });
    const batch = yield* classification.batch({ runId: run.id });
    yield* classification.complete({
      commandId: batch.commandId,
      runId: run.id,
      expectedVersions: batch.items.map((item) => ({
        eventId: item.eventId,
        version: item.eventVersion,
      })),
      report: {
        status: "failed",
        results: [],
        inputTokens: null,
        outputTokens: null,
        cost: null,
        failure: "Provider unavailable",
      },
    });
    expect(yield* classification.suggestions).toEqual([]);
    expect((yield* classification.runs)[0]?.status).toBe("failed");
    const next = yield* classification.request({ commandId: yield* commandId, eventIds: "all" });
    const nextBatch = yield* classification.batch({ runId: next.id });
    yield* classification.complete({
      commandId: nextBatch.commandId,
      runId: next.id,
      expectedVersions: nextBatch.items.map((item) => ({
        eventId: item.eventId,
        version: item.eventVersion,
      })),
      report: {
        status: "failed",
        results: [],
        inputTokens: 100n,
        outputTokens: 40n,
        cost: { currency: "USD", minor: 1n },
        failure: "Invalid output",
      },
    });
    const usage = yield* (yield* Models).get;
    expect(usage.calls).toBe(2);
    expect(usage.unknownUsage).toBe(1);
    const blocked = yield* classification
      .request({ commandId: yield* commandId, eventIds: "all" })
      .pipe(Effect.result);
    expect(blocked._tag === "Failure" && blocked.failure.message).toContain("threshold");
    const event = rows[0];
    if (!event) return yield* Effect.die("Expected event");
    const corrections = yield* Corrections;
    expect(
      (yield* corrections.apply({
        commandId: yield* commandId,
        expectedVersions: [{ eventId: event.id, version: event.version }],
        change: {
          eventId: event.id,
          kind: event.kind,
          purchaseOn: null,
          allocations: [{ ...event.allocations[0], categoryId: groceries }],
        },
      })).allocations[0].categoryId,
    ).toBe(groceries);
  }).pipe(Effect.provide(Models.layer.pipe(Layer.provideMerge(services)))),
);

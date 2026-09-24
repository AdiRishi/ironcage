import { AllocationId, CategoryId, CommandId, RuleId, type Rule } from "@repo/contracts/finance";
import { Crypto, Effect } from "effect";
import { expect } from "vitest";

import { Corrections } from "../../src/events/corrections.ts";
import { Events } from "../../src/events/service.ts";
import { Publication } from "../../src/imports/publication.ts";
import { Questions } from "../../src/interpretation/questions.ts";
import { Postings } from "../../src/postings/service.ts";
import { References } from "../../src/references/service.ts";
import { Rules } from "../../src/rules/service.ts";
import { applicationTest } from "../support/application.ts";
import { account, parsed, reset, source } from "../support/fixtures.ts";
const { test, services } = applicationTest();
const uuid = Crypto.Crypto.use((crypto) => crypto.randomUUIDv4);
const commandId = uuid.pipe(Effect.map((id) => CommandId.make(id)));
const groceries = CategoryId.make("00000000-0000-4000-8000-000000000001");
const household = CategoryId.make("00000000-0000-4000-8000-000000000002");
const setup = Effect.gen(function* () {
  yield* reset;
  const owner = yield* account();
  const file = yield* source(owner.id);
  const publication = yield* Publication;
  const data = parsed([
    "Synthetic market one Card xx1234",
    "Synthetic market two Card xx1234",
    "Synthetic market split Card xx1234",
  ]);
  yield* publication.publish({
    ...data,
    importId: file.importId,
    observations: data.observations.map((row) => ({
      ...row,
      candidate: row.candidate
        ? { ...row.candidate, amount: { currency: "AUD", minor: -15000n } }
        : null,
    })),
  });
  const events = yield* Events;
  yield* events.interpret({ commandId: yield* commandId });
  const postings = yield* Postings;
  const rows = yield* Effect.forEach(
    (yield* postings.list({ filter: { accountId: owner.id } })).rows,
    (posting) =>
      Effect.gen(function* () {
        const event = yield* events.forPosting({ postingId: posting.id });
        if (!event) return yield* Effect.die("Expected event");
        return event;
      }),
  );
  const rule: Rule = {
    id: RuleId.make(yield* uuid),
    name: "Market groceries",
    conditions: {
      accountId: null,
      role: "purchase",
      counterpartyId: null,
      channel: null,
      description: "Synthetic market",
    },
    action: { kind: "category", categoryId: groceries },
    scope: "both",
    version: 1,
  };
  return { owner, events, rows, rule, publication };
});
test(
  "rules preserve a corrected split and explicit exceptions, and conflicting rules restore the pre-rule interpretation",
  Effect.gen(function* () {
    const { events, rows, rule } = yield* setup;
    const split = rows.find((event) => event.postings[0]?.description.includes("split"));
    const normal = rows.find((event) => event.postings[0]?.description.includes("one"));
    const excluded = rows.find((event) => event.postings[0]?.description.includes("two"));
    if (!split || !normal || !excluded) return yield* Effect.die("Expected synthetic events");
    const corrections = yield* Corrections;
    yield* corrections.apply({
      commandId: yield* commandId,
      expectedVersions: [{ eventId: split.id, version: split.version }],
      change: {
        eventId: split.id,
        kind: "purchase",
        purchaseOn: null,
        allocations: [
          {
            ...split.allocations[0],
            amount: { currency: "AUD", minor: 10000n },
            categoryId: groceries,
          },
          {
            ...split.allocations[0],
            id: AllocationId.make(yield* uuid),
            amount: { currency: "AUD", minor: 5000n },
            categoryId: household,
          },
        ],
      },
    });
    const corrected = yield* events.get({ eventId: split.id });
    const rules = yield* Rules;
    const preview = yield* rules.preview({ rule, exceptionEventIds: [excluded.id] });
    expect(preview.matched).toBe(3);
    expect(preview.affected).toEqual([normal.id]);
    expect(new Set(preview.exceptions.map((row) => row.eventId))).toEqual(
      new Set([split.id, excluded.id]),
    );
    yield* rules.save({
      commandId: yield* commandId,
      rule,
      exceptionEventIds: [excluded.id],
      expectedVersion: null,
      expectedVersions: preview.expectedVersions,
    });
    expect((yield* events.get({ eventId: normal.id })).allocations[0].categoryId).toBe(groceries);
    expect(yield* events.get({ eventId: split.id })).toEqual(corrected);
    const conflicting: Rule = {
      ...rule,
      id: RuleId.make(yield* uuid),
      name: "Market household",
      action: { kind: "category", categoryId: household },
    };
    const conflict = yield* rules.preview({ rule: conflicting, exceptionEventIds: [] });
    expect(conflict.conflicts).toEqual([normal.id]);
    yield* rules.save({
      commandId: yield* commandId,
      rule: conflicting,
      exceptionEventIds: [],
      expectedVersion: null,
      expectedVersions: conflict.expectedVersions,
    });
    expect((yield* events.get({ eventId: normal.id })).allocations[0].categoryId).toBeNull();
    const questions = yield* Questions;
    expect(
      (yield* questions.list({ currency: "AUD" })).some(
        (question) =>
          question.kind === "ruleConflict" &&
          question.samples.some((sample) => sample.eventId === normal.id),
      ),
    ).toBe(true);
    expect(yield* events.get({ eventId: split.id })).toEqual(corrected);
    const repeated = yield* rules.preview({
      rule: { ...conflicting, version: 1 },
      exceptionEventIds: [],
    });
    expect(repeated.conflicts).toEqual([normal.id]);
  }).pipe(Effect.provide(services)),
);

test(
  "future rules apply to new interpretation only and stale previews cannot overwrite a correction",
  Effect.gen(function* () {
    const { owner, events, rows, rule, publication } = yield* setup;
    const rules = yield* Rules;
    const future: Rule = { ...rule, scope: "future" };
    const preview = yield* rules.preview({ rule: future, exceptionEventIds: [] });
    expect(preview.affected).toEqual([]);
    yield* rules.save({
      commandId: yield* commandId,
      rule: future,
      exceptionEventIds: [],
      expectedVersion: null,
      expectedVersions: preview.expectedVersions,
    });
    const file = yield* source(owner.id);
    yield* publication.publish({
      ...parsed(["Synthetic market later Card xx1234"]),
      importId: file.importId,
    });
    yield* events.interpret({ commandId: yield* commandId });
    const postings = yield* Postings;
    const [laterPosting] = (yield* postings.list({ filter: { importId: file.importId } })).rows;
    if (!laterPosting) return yield* Effect.die("Expected later posting");
    const later = yield* events.forPosting({ postingId: laterPosting.id });
    expect(later?.allocations[0].categoryId).toBe(groceries);
    const changedFuture: Rule = { ...future, action: { kind: "category", categoryId: household } };
    const futureEdit = yield* rules.preview({ rule: changedFuture, exceptionEventIds: [] });
    expect(futureEdit.affected).toEqual([]);
    yield* rules.save({
      commandId: yield* commandId,
      rule: changedFuture,
      exceptionEventIds: [],
      expectedVersion: 1,
      expectedVersions: futureEdit.expectedVersions,
    });
    if (!later) return yield* Effect.die("Expected later event");
    expect((yield* events.get({ eventId: later.id })).allocations[0].categoryId).toBe(groceries);
    const agreeing: Rule = {
      ...rule,
      id: RuleId.make(yield* uuid),
      name: "Agree with prior application",
      scope: "past",
      conditions: { ...rule.conditions, description: "Synthetic market later" },
    };
    const agreement = yield* rules.preview({ rule: agreeing, exceptionEventIds: [] });
    expect(agreement.conflicts).toEqual([]);
    const original = rows[0];
    if (!original) return yield* Effect.die("Expected original event");
    expect((yield* events.get({ eventId: original.id })).allocations[0].categoryId).toBeNull();
    const past = { ...future, scope: "both" } satisfies Rule;
    const broad = yield* rules.preview({ rule: past, exceptionEventIds: [] });
    const corrections = yield* Corrections;
    yield* corrections.apply({
      commandId: yield* commandId,
      expectedVersions: [{ eventId: original.id, version: original.version }],
      change: {
        eventId: original.id,
        kind: "purchase",
        purchaseOn: null,
        allocations: [{ ...original.allocations[0], categoryId: household }],
      },
    });
    const stale = yield* rules
      .save({
        commandId: yield* commandId,
        rule: past,
        exceptionEventIds: [],
        expectedVersion: 2,
        expectedVersions: broad.expectedVersions,
      })
      .pipe(Effect.result);
    expect(stale._tag === "Failure" && stale.failure.kind).toBe("stale");
    expect((yield* events.get({ eventId: original.id })).allocations[0].categoryId).toBe(household);
  }).pipe(Effect.provide(services)),
);

test(
  "a category assigned by a rule cannot be archived until that rule is removed",
  Effect.gen(function* () {
    const { rule } = yield* setup;
    const rules = yield* Rules;
    const preview = yield* rules.preview({ rule, exceptionEventIds: [] });
    yield* rules.save({
      commandId: yield* commandId,
      rule,
      exceptionEventIds: [],
      expectedVersion: null,
      expectedVersions: preview.expectedVersions,
    });
    const references = yield* References;
    const record = {
      kind: "category",
      target: { kind: "update", id: groceries, expectedVersion: 1 },
      name: "Groceries",
      parentId: null,
      archived: true,
    } as const;
    const blocked = yield* references
      .save({ commandId: yield* commandId, record })
      .pipe(Effect.result);
    expect(blocked._tag === "Failure" && blocked.failure.kind).toBe("conflict");
    yield* rules.remove({ commandId: yield* commandId, ruleId: rule.id, expectedVersion: 1 });
    expect(yield* references.save({ commandId: yield* commandId, record })).toBe(true);
  }).pipe(Effect.provide(services)),
);

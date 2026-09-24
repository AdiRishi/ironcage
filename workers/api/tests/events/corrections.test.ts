import { PgClient } from "@effect/sql-pg";
import { AllocationId, CategoryId, CommandId, type EventChange } from "@repo/contracts/finance";
import { Crypto, Effect } from "effect";
import { expect } from "vitest";

import { Corrections } from "../../src/events/corrections.ts";
import { Events } from "../../src/events/service.ts";
import { Publication } from "../../src/imports/publication.ts";
import { Postings } from "../../src/postings/service.ts";
import { References } from "../../src/references/service.ts";
import { applicationTest } from "../support/application.ts";
import { account, parsed, reset, source } from "../support/fixtures.ts";

const { test, services } = applicationTest();
const commandId = Crypto.Crypto.use((crypto) => crypto.randomUUIDv4).pipe(
  Effect.map((id) => CommandId.make(id)),
);
const purchase = Effect.gen(function* () {
  yield* reset;
  const owner = yield* account();
  const file = yield* source(owner.id);
  const data = parsed(["Synthetic grocery Card xx1234"]);
  const publication = yield* Publication;
  yield* publication.publish({
    ...data,
    observations: data.observations.map((row) => ({
      ...row,
      candidate: row.candidate
        ? { ...row.candidate, amount: { currency: "AUD", minor: -15000n } }
        : null,
    })),
    importId: file.importId,
  });
  const events = yield* Events;
  yield* events.interpret({ commandId: yield* commandId });
  const postings = yield* Postings;
  const [posting] = (yield* postings.list({ filter: {} })).rows;
  if (!posting) return yield* Effect.die("Expected posting");
  const event = yield* events.forPosting({ postingId: posting.id });
  if (!event) return yield* Effect.die("Expected event");
  const [allocation] = event.allocations;
  if (!allocation) return yield* Effect.die("Expected allocation");
  return { event, posting, allocation };
});
test(
  "splits conserve money, stale saves fail, and undo records a new correction",
  Effect.gen(function* () {
    const { event, allocation, posting } = yield* purchase;
    const corrections = yield* Corrections;
    const groceries = CategoryId.make("00000000-0000-4000-8000-000000000001");
    const household = CategoryId.make("00000000-0000-4000-8000-000000000002");
    const split = {
      eventId: event.id,
      kind: event.kind,
      purchaseOn: null,
      allocations: [
        { ...allocation, categoryId: groceries, amount: { currency: "AUD", minor: 10000n } },
        {
          ...allocation,
          id: AllocationId.make(yield* Crypto.Crypto.use((crypto) => crypto.randomUUIDv4)),
          categoryId: household,
          amount: { currency: "AUD", minor: 5000n },
        },
      ],
    } satisfies EventChange;
    const preview = yield* corrections.preview({ change: split });
    expect(preview.impact.before.netPersonalCosts.minor).toBe(15000n);
    expect(preview.impact.after.netPersonalCosts.minor).toBe(15000n);
    expect(preview.impact.after.cashChange).toBeNull();
    expect(preview.impact.after.observedCashMovement.minor).toBe(-15000n);
    const input = {
      commandId: yield* commandId,
      change: split,
      expectedVersions: preview.expectedVersions,
    };
    const accepted = yield* corrections.apply(input);
    expect(accepted.allocations.map((row) => row.amount.minor)).toEqual([10000n, 5000n]);
    expect(yield* corrections.apply(input)).toEqual(accepted);
    const stale = yield* corrections
      .apply({ ...input, commandId: yield* commandId })
      .pipe(Effect.result);
    expect(stale._tag === "Failure" && stale.failure.kind).toBe("stale");
    const history = yield* corrections.history({ eventId: event.id });
    expect(history).toHaveLength(1);
    const correction = history[0];
    if (!correction) return yield* Effect.die("Expected correction");
    const undone = yield* corrections.undo({
      commandId: yield* commandId,
      correctionId: correction.id,
      expectedVersions: [{ eventId: event.id, version: accepted.version }],
    });
    expect(undone.allocations).toEqual(event.allocations);
    expect(yield* corrections.history({ eventId: event.id })).toHaveLength(2);
    const postings = yield* Postings;
    expect((yield* postings.get({ postingId: posting.id })).posting).toEqual(posting);
    const invalid = yield* corrections
      .preview({
        change: {
          ...split,
          allocations: [{ ...allocation, amount: { currency: "AUD", minor: 15100n } }],
        },
      })
      .pipe(Effect.result);
    expect(invalid._tag === "Failure" && invalid.failure.kind).toBe("conflict");
  }).pipe(Effect.provide(services)),
);

test(
  "renaming a category preserves assignments and interpretation reruns preserve corrections",
  Effect.gen(function* () {
    const { event, allocation } = yield* purchase;
    const corrections = yield* Corrections;
    const references = yield* References;
    const events = yield* Events;
    const category = (yield* events.references).categories[0];
    if (!category) return yield* Effect.die("Expected seeded category");
    const change = {
      eventId: event.id,
      kind: event.kind,
      purchaseOn: null,
      allocations: [{ ...allocation, categoryId: category.id }],
    } satisfies EventChange;
    const accepted = yield* corrections.apply({
      commandId: yield* commandId,
      change,
      expectedVersions: [{ eventId: event.id, version: event.version }],
    });
    yield* references.save({
      commandId: yield* commandId,
      record: {
        kind: "category",
        target: { kind: "update", id: category.id, expectedVersion: category.version },
        name: "Renamed category",
        parentId: null,
        archived: false,
      },
    });
    expect((yield* events.references).categories.find((row) => row.id === category.id)?.name).toBe(
      "Renamed category",
    );
    expect((yield* events.get({ eventId: event.id })).allocations[0]?.categoryId).toBe(category.id);
    expect((yield* events.interpret({ commandId: yield* commandId })).created).toBe(0);
    expect(yield* events.get({ eventId: event.id })).toEqual(accepted);
    const deletion = yield* references
      .remove({
        commandId: yield* commandId,
        record: { kind: "category", id: category.id, expectedVersion: category.version + 1 },
      })
      .pipe(Effect.result);
    expect(deletion._tag === "Failure" && deletion.failure.kind).toBe("conflict");
  }).pipe(Effect.provide(services)),
);

test(
  "monthly previews combine consecutive statement coverage and reject a one-day gap",
  Effect.gen(function* () {
    const { event, posting, allocation } = yield* purchase;
    const sql = yield* PgClient.PgClient;
    const first = yield* source(posting.accountId);
    const second = yield* source(posting.accountId);
    yield* sql`INSERT INTO source_coverage(id,source_file_id,account_id,stated_start,stated_end,observed_start,observed_end,opening_minor,opening_on,closing_minor,closing_on,reconciled) VALUES
    (gen_random_uuid(),${first.sourceFileId},${posting.accountId},'2026-09-01','2026-09-15','2026-09-01','2026-09-01',100000,'2026-09-01',85000,'2026-09-15',true),
    (gen_random_uuid(),${second.sourceFileId},${posting.accountId},'2026-09-16','2026-09-30','2026-09-16','2026-09-30',85000,'2026-09-16',85000,'2026-09-30',true)`;
    const corrections = yield* Corrections;
    const input = {
      change: {
        eventId: event.id,
        kind: event.kind,
        purchaseOn: event.purchaseOn,
        allocations: [allocation],
      },
    } satisfies Parameters<typeof corrections.preview>[0];
    expect((yield* corrections.preview(input)).impact.before.cashChange).toEqual({
      currency: "AUD",
      minor: -15000n,
    });
    yield* sql`UPDATE source_coverage SET opening_on='2026-09-17',stated_start='2026-09-17',observed_start='2026-09-17' WHERE source_file_id=${second.sourceFileId}`;
    const incomplete = yield* corrections.preview(input);
    expect(incomplete.impact.before.cashChange).toBeNull();
    expect(incomplete.impact.before.observedCashMovement.minor).toBe(-15000n);
  }).pipe(Effect.provide(services)),
);

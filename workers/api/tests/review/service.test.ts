import {
  AllocationId,
  CalendarDate,
  CommandId,
  type FlowInput,
  type ObservationDecision,
  type ReviewItem,
} from "@repo/contracts/finance";
import { Crypto, Effect } from "effect";
import { expect } from "vitest";

import { Flows } from "../../src/analysis/flows.ts";
import { Corrections } from "../../src/events/corrections.ts";
import { Events } from "../../src/events/service.ts";
import { Publication } from "../../src/imports/publication.ts";
import { Postings } from "../../src/postings/service.ts";
import { Reviews } from "../../src/review/service.ts";
import { applicationTest } from "../support/application.ts";
import { account, parsed, reset, source } from "../support/fixtures.ts";

const { test, services } = applicationTest();
const resolve = Effect.fn("resolveFixtureReview")(function* (
  review: ReviewItem,
  decision: ObservationDecision,
) {
  const row = review.observations[0];
  if (!row) return yield* Effect.die("Expected a review row.");
  return yield* (yield* Reviews).resolve({
    commandId: CommandId.make(yield* Crypto.Crypto.use((crypto) => crypto.randomUUIDv4)),
    reviewItemId: review.id,
    expectedVersion: review.version,
    resolution: { kind: "observations", decisions: [{ observationId: row.id, decision }] },
  });
});
const pending = Effect.gen(function* () {
  const review = (yield* (yield* Reviews).list()).rows[0];
  if (!review) return yield* Effect.die("Expected a pending review.");
  return review;
});
const unreadable = () => {
  const file = parsed(["Coffee"]);
  return {
    ...file,
    observations: file.observations.map((row) => ({
      ...row,
      candidate: null,
      issue: { code: "unreadableDate" as const, literal: "Unreadable date" },
    })),
  };
};
const correction = () => {
  const candidate = parsed(["Coffee"]).observations[0]?.candidate;
  if (!candidate) throw new Error("Expected a decoded correction.");
  return candidate;
};

test(
  "correcting an unreadable overlapping row attaches it to the existing transaction",
  Effect.gen(function* () {
    yield* reset;
    const owner = yield* account();
    const first = yield* source(owner.id);
    const second = yield* source(owner.id);
    const publication = yield* Publication;
    yield* publication.publish({ ...parsed(["Coffee"]), importId: first.importId });
    yield* publication.publish({ ...unreadable(), importId: second.importId });
    const summary = yield* resolve(yield* pending, {
      kind: "correct",
      candidate: correction(),
      postingId: null,
    });
    expect(summary).toEqual({
      observations: 1,
      newPostings: 0,
      matchedPostings: 1,
      reviewItems: 0,
    });
    yield* publication.publish({
      ...unreadable(),
      parserVersion: "test-2",
      importId: second.importId,
    });
    const postings = yield* Postings;
    const page = yield* postings.list({ filter: {} });
    expect(page.rows).toHaveLength(1);
    expect((yield* postings.get({ postingId: page.rows[0]!.id })).evidence).toHaveLength(2);
  }).pipe(Effect.provide(services)),
);

for (const kind of ["match", "distinct"] as const)
  test(
    `a corrected value survives a subsequent ${kind} decision and reparse`,
    Effect.gen(function* () {
      yield* reset;
      const owner = yield* account();
      const first = yield* source(owner.id);
      const second = yield* source(owner.id);
      const publication = yield* Publication;
      yield* publication.publish({ ...parsed(["Coffee", "Coffee"]), importId: first.importId });
      yield* publication.publish({ ...unreadable(), importId: second.importId });
      expect(
        (yield* resolve(yield* pending, {
          kind: "correct",
          candidate: correction(),
          postingId: null,
        })).reviewItems,
      ).toBe(1);
      const review = yield* pending;
      expect(review.kind).toBe("duplicate");
      expect(review.observations[0]?.candidate).toEqual(correction());
      const decision = kind === "match" ? { kind, postingId: review.candidates[0]!.id } : { kind };
      expect((yield* resolve(review, decision)).reviewItems).toBe(0);
      yield* publication.publish({
        ...unreadable(),
        parserVersion: "test-2",
        importId: second.importId,
      });
      const postings = yield* Postings;
      expect((yield* postings.list({ filter: {} })).rows).toHaveLength(kind === "match" ? 2 : 3);
      const page = yield* postings.list({ filter: { importId: second.importId } });
      expect(page.rows).toHaveLength(1);
      expect(page.rows[0]?.amount.minor).toBe(-450n);
      expect((yield* (yield* Reviews).list()).rows).toHaveLength(0);
    }).pipe(Effect.provide(services)),
  );

test(
  "the latest accepted correction wins across sources and survives reparsing older evidence",
  Effect.gen(function* () {
    yield* reset;
    const owner = yield* account();
    const ofx = yield* source(owner.id, "ofx");
    const csv = yield* source(owner.id, "csv");
    const publication = yield* Publication;
    const file = parsed(["Coffee"]);
    yield* publication.publish({ ...file, importId: ofx.importId });
    yield* publication.publish({ ...file, importId: csv.importId });
    yield* publication.publish({
      ...parsed(["New OFX wording"]),
      parserVersion: "test-2",
      importId: ofx.importId,
    });
    const review = yield* pending;
    const accepted = review.observations[0]!;
    yield* resolve(review, {
      kind: "keep",
      candidate: accepted.acceptedCandidate!,
      postingId: accepted.postingId!,
    });
    const candidate = { ...correction(), amount: { currency: "AUD", minor: -550n } };
    yield* publication.publish({
      ...file,
      parserVersion: "test-2",
      importId: csv.importId,
      observations: file.observations.map((row) => ({ ...row, candidate })),
    });
    const next = yield* pending;
    yield* resolve(next, {
      kind: "correct",
      candidate,
      postingId: next.observations[0]!.postingId,
    });
    const postings = yield* Postings;
    expect((yield* postings.get({ postingId: accepted.postingId! })).posting.amount.minor).toBe(
      -550n,
    );
    yield* publication.publish({ ...file, parserVersion: "test-3", importId: ofx.importId });
    expect((yield* postings.get({ postingId: accepted.postingId! })).posting.amount.minor).toBe(
      -550n,
    );
    expect((yield* (yield* Reviews).list()).rows).toHaveLength(0);
  }).pipe(Effect.provide(services)),
);

test(
  "a reviewed correction that moves a transaction's date moves it in the flow",
  Effect.gen(function* () {
    yield* reset;
    const owner = yield* account();
    const ofx = yield* source(owner.id, "ofx");
    const csv = yield* source(owner.id, "csv");
    const publication = yield* Publication;
    const file = parsed(["Coffee"]);
    yield* publication.publish({ ...file, importId: ofx.importId });
    yield* publication.publish({ ...file, importId: csv.importId });
    const month = (start: string, endExclusive: string): FlowInput => ({
      period: {
        kind: "fixed",
        start: CalendarDate.make(start),
        endExclusive: CalendarDate.make(endExclusive),
      },
      comparison: { kind: "previous" },
      basis: "posted",
      currency: "AUD",
    });
    const outflow = Effect.fn(function* (input: FlowInput) {
      return (yield* (yield* Flows).period(input)).totals.outflow.minor;
    });
    expect(yield* outflow(month("2026-09-01", "2026-10-01"))).toBe(450n);

    const candidate = { ...correction(), postedOn: CalendarDate.make("2026-08-20") };
    yield* publication.publish({
      ...file,
      parserVersion: "test-2",
      importId: csv.importId,
      observations: file.observations.map((row) => ({ ...row, candidate })),
    });
    const review = yield* pending;
    yield* resolve(review, {
      kind: "correct",
      candidate,
      postingId: review.observations[0]!.postingId,
    });
    expect(yield* outflow(month("2026-09-01", "2026-10-01"))).toBe(0n);
    expect(yield* outflow(month("2026-08-01", "2026-09-01"))).toBe(450n);
  }).pipe(Effect.provide(services)),
);

const reviewedAmount = Effect.gen(function* () {
  yield* reset;
  const owner = yield* account();
  const ofx = yield* source(owner.id, "ofx");
  const csv = yield* source(owner.id, "csv");
  const publication = yield* Publication;
  const file = parsed(["Coffee"]);
  yield* publication.publish({ ...file, importId: ofx.importId });
  yield* publication.publish({ ...file, importId: csv.importId });
  const candidate = { ...correction(), amount: { currency: "AUD", minor: -550n } };
  yield* publication.publish({
    ...file,
    parserVersion: "test-2",
    importId: csv.importId,
    observations: file.observations.map((row) => ({ ...row, candidate })),
  });
  const review = yield* pending;
  const decision = {
    kind: "correct",
    candidate,
    postingId: review.observations[0]!.postingId,
  } as const;
  const [posting] = (yield* (yield* Postings).list({ filter: {} })).rows;
  const event = posting ? yield* (yield* Events).forPosting({ postingId: posting.id }) : null;
  if (!event) return yield* Effect.die("Expected the synthetic event");
  return { review, decision, event };
});
const september = {
  period: {
    kind: "fixed",
    start: CalendarDate.make("2026-09-01"),
    endExclusive: CalendarDate.make("2026-10-01"),
  },
  comparison: { kind: "previous" },
  basis: "posted",
  currency: "AUD",
} satisfies FlowInput;

test(
  "a reviewed correction to a transaction's amount carries through to its event and the flow",
  Effect.gen(function* () {
    const { review, decision, event } = yield* reviewedAmount;
    yield* resolve(review, decision);
    const corrected = yield* (yield* Events).get({ eventId: event.id });
    expect(corrected.magnitude.minor).toBe(550n);
    expect(corrected.allocations.map((allocation) => allocation.amount.minor)).toEqual([550n]);
    expect((yield* (yield* Flows).period(september)).totals.outflow.minor).toBe(550n);
  }).pipe(Effect.provide(services)),
);

test(
  "a reviewed amount correction to a split transaction asks you to undo the split first",
  Effect.gen(function* () {
    const { review, decision, event } = yield* reviewedAmount;
    const [allocation] = event.allocations;
    yield* (yield* Corrections).apply({
      commandId: CommandId.make(yield* Crypto.Crypto.use((crypto) => crypto.randomUUIDv4)),
      expectedVersions: [{ eventId: event.id, version: event.version }],
      change: {
        eventId: event.id,
        kind: "purchase",
        purchaseOn: null,
        allocations: [
          { ...allocation, role: "purchase", amount: { currency: "AUD", minor: 300n } },
          {
            ...allocation,
            id: AllocationId.make(yield* Crypto.Crypto.use((crypto) => crypto.randomUUIDv4)),
            role: "purchase",
            amount: { currency: "AUD", minor: 150n },
          },
        ],
      },
    });
    const refused = yield* resolve(review, decision).pipe(Effect.result);
    expect(refused._tag === "Failure" && refused.failure).toMatchObject({ kind: "conflict" });
    expect((yield* (yield* Flows).period(september)).totals.outflow.minor).toBe(450n);
  }).pipe(Effect.provide(services)),
);

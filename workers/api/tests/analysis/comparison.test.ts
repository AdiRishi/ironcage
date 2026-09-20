import { CalendarDate, CommandId, type AnalysisQuery } from "@repo/contracts/finance";
import { Clock, Crypto, Effect } from "effect";
import { expect } from "vitest";

import { Analysis } from "../../src/analysis/service.ts";
import { Events } from "../../src/events/service.ts";
import { Publication } from "../../src/imports/publication.ts";
import { applicationTest } from "../support/application.ts";
import { account, source, parsed, reset } from "../support/fixtures.ts";
const { test, services } = applicationTest();
test(
  "analysis operations reject out-of-range current and comparison dates as invalid input",
  Effect.gen(function* () {
    yield* reset;
    const analysis = yield* Analysis;
    const clock = yield* Clock.Clock;
    yield* Effect.gen(function* () {
      for (const count of [2027, 1500]) {
        const query: AnalysisQuery = {
          period: { kind: "calendar", unit: "year", count, offset: 0, alignment: "full" },
          comparison: { kind: "previous" },
          measure: "netPersonalCosts",
          basis: "spending",
          currency: "AUD",
          accounts: [],
          filters: { categories: [], merchants: [], tags: [], personalEvents: [] },
          normalization: "total",
        };
        if (count === 2027)
          expect((yield* analysis.overview(query).pipe(Effect.flip)).kind).toBe("invalid");
        expect((yield* analysis.compare(query).pipe(Effect.flip)).kind).toBe("invalid");
        expect(
          (yield* analysis.contributors({ query, groupBy: "category" }).pipe(Effect.flip)).kind,
        ).toBe("invalid");
        expect(
          (yield* analysis
            .rows({ query, groupBy: "category", groupKey: "unassigned" })
            .pipe(Effect.flip)).kind,
        ).toBe("invalid");
      }
    }).pipe(
      Effect.provideService(Clock.Clock, {
        currentTimeNanos: clock.currentTimeNanos,
        currentTimeNanosUnsafe: () => clock.currentTimeNanosUnsafe(),
        monotonicTimeNanos: clock.monotonicTimeNanos,
        monotonicTimeNanosUnsafe: () => clock.monotonicTimeNanosUnsafe(),
        sleep: (duration) => clock.sleep(duration),
        currentTimeMillis: Effect.succeed(Date.parse("2026-09-20T00:00:00.000Z")),
        currentTimeMillisUnsafe: () => Date.parse("2026-09-20T00:00:00.000Z"),
      }),
    );
  }).pipe(Effect.provide(services)),
);
test(
  "the comparison API returns the delivery example with its consistent contributors",
  Effect.gen(function* () {
    yield* reset;
    const owner = yield* account();
    const file = yield* source(owner.id);
    const base = parsed(Array.from({ length: 22 }, (_, i) => `Delivery ${i + 1} Card xx1234`));
    const publication = yield* Publication;
    yield* publication.publish({
      ...base,
      importId: file.importId,
      observations: base.observations.map((observation, index) => ({
        ...observation,
        candidate: observation.candidate
          ? {
              ...observation.candidate,
              postedOn: CalendarDate.make(index < 10 ? "2026-07-02" : "2026-08-02"),
              amount: { currency: "AUD", minor: index < 10 ? -2000n : -2500n },
            }
          : null,
      })),
    });
    const events = yield* Events;
    yield* events.interpret({
      commandId: CommandId.make(yield* Crypto.Crypto.use((crypto) => crypto.randomUUIDv4)),
      scope: "all",
    });
    const query: AnalysisQuery = {
      period: {
        kind: "fixed",
        start: CalendarDate.make("2026-08-01"),
        endExclusive: CalendarDate.make("2026-09-01"),
      },
      comparison: {
        kind: "fixed",
        start: CalendarDate.make("2026-07-01"),
        endExclusive: CalendarDate.make("2026-08-01"),
      },
      basis: "spending",
      currency: "AUD",
      accounts: [owner.id],
      measure: "netPersonalCosts",
      filters: { categories: [], merchants: [], tags: [], personalEvents: [] },
      normalization: "total",
    };
    const analysis = yield* Analysis;
    const result = yield* analysis.contributors({ query, groupBy: "category" });
    expect(result.comparison.current.total).toEqual({
      kind: "money",
      amount: { currency: "AUD", minor: 30000n },
    });
    expect(result.comparison.previous.total).toEqual({
      kind: "money",
      amount: { currency: "AUD", minor: 20000n },
    });
    expect(result.comparison.relativeChange).toBe("50.000000");
    expect(result.rows[0]?.frequencyContribution?.minor).toBe(4500n);
    expect(result.rows[0]?.averageCostContribution?.minor).toBe(5500n);
    expect(result.rows[0]?.current.purchaseCount).toBe(12);
    expect(result.rows[0]?.previous.purchaseCount).toBe(10);
  }).pipe(Effect.provide(services)),
);

import { PgClient } from "@effect/sql-pg";
import { CalendarDate, CommandId, type ContributorsInput } from "@repo/contracts/finance";
import { Clock, Crypto, Effect, Schema } from "effect";
import { expect } from "vitest";

import { SavedAnalyses } from "../../src/analysis/saved.ts";
import { Analysis } from "../../src/analysis/service.ts";
import { takeSnapshot } from "../../src/exports/snapshot.ts";
import { applicationTest } from "../support/application.ts";
import { reset } from "../support/fixtures.ts";

const { test, services } = applicationTest();
const commandId = Crypto.Crypto.use((crypto) => crypto.randomUUIDv4).pipe(
  Effect.map((id) => CommandId.make(id)),
);
const definition: typeof ContributorsInput.Type = {
  query: {
    period: { kind: "rolling", days: 30 },
    comparison: { kind: "previous" },
    measure: "netPersonalCosts",
    basis: "spending",
    currency: "AUD",
    accounts: [],
    filters: { categories: [], merchants: [], tags: [], personalEvents: [] },
    normalization: "total",
  },
  groupBy: "merchant",
};

test(
  "saved definitions survive replay and export, while stale renames and deletes change nothing",
  Effect.gen(function* () {
    yield* reset;
    const analyses = yield* SavedAnalyses;
    const input = { commandId: yield* commandId, name: "Last month of purchases", definition };
    const saved = yield* analyses.save(input);
    expect(yield* analyses.save(input)).toEqual(saved);
    expect(yield* analyses.list).toEqual([saved]);
    const renamed = yield* analyses.rename({
      commandId: yield* commandId,
      id: saved.id,
      expectedVersion: 1,
      name: "Recent purchases",
    });
    expect(renamed.name).toBe("Recent purchases");
    expect(renamed.version).toBe(2);
    expect(renamed.definition).toEqual(definition);
    const staleRename = yield* analyses
      .rename({
        commandId: yield* commandId,
        id: saved.id,
        expectedVersion: 1,
        name: "Outdated name",
      })
      .pipe(Effect.flip);
    expect(staleRename.kind).toBe("stale");
    const staleDelete = yield* analyses
      .remove({ commandId: yield* commandId, id: saved.id, expectedVersion: 1 })
      .pipe(Effect.flip);
    expect(staleDelete.kind).toBe("stale");
    expect(yield* analyses.get({ id: saved.id })).toEqual(renamed);
    const sql = yield* PgClient.PgClient;
    const snapshot = yield* takeSnapshot(sql);
    const exported = snapshot.tables.find((table) => table.name === "saved_analyses");
    const rows = yield* Schema.decodeUnknownEffect(
      Schema.fromJsonString(Schema.Array(Schema.Record(Schema.String, Schema.Json))),
    )(exported?.json);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      id: saved.id,
      name: "Recent purchases",
      query: definition,
      version: 2,
      created_at: saved.createdAt,
      updated_at: renamed.updatedAt,
    });
    const remove = { commandId: yield* commandId, id: saved.id, expectedVersion: 2 };
    expect(yield* analyses.remove(remove)).toBe(true);
    expect(yield* analyses.remove(remove)).toBe(true);
    expect(yield* analyses.list).toEqual([]);
    expect((yield* analyses.get({ id: saved.id }).pipe(Effect.flip)).kind).toBe("notFound");
  }).pipe(Effect.provide(services)),
);

test(
  "reopening resolves relative dates in Sydney and advances them seven days, while fixed dates stay fixed",
  Effect.gen(function* () {
    yield* reset;
    const sql = yield* PgClient.PgClient;
    yield* sql`UPDATE settings SET timezone='Australia/Sydney' WHERE id=1`;
    const saved = yield* SavedAnalyses;
    const analysis = yield* Analysis;
    const rolling = yield* saved.save({ commandId: yield* commandId, name: "Rolling", definition });
    const fixedDefinition: typeof ContributorsInput.Type = {
      ...definition,
      query: {
        ...definition.query,
        period: {
          kind: "fixed",
          start: CalendarDate.make("2026-08-01"),
          endExclusive: CalendarDate.make("2026-09-01"),
        },
      },
    };
    const fixed = yield* saved.save({
      commandId: yield* commandId,
      name: "Fixed",
      definition: fixedDefinition,
    });
    const month = yield* saved.save({
      commandId: yield* commandId,
      name: "Month",
      definition: {
        ...definition,
        query: {
          ...definition.query,
          period: { kind: "calendar", unit: "month", count: 1, offset: 0, alignment: "elapsed" },
        },
      },
    });
    const clock = yield* Clock.Clock;
    const openAt = (id: typeof rolling.id, instant: string) =>
      Effect.gen(function* () {
        const record = yield* saved.get({ id });
        return yield* analysis.contributors(record.definition);
      }).pipe(
        Effect.provideService(Clock.Clock, {
          currentTimeNanos: clock.currentTimeNanos,
          currentTimeNanosUnsafe: () => clock.currentTimeNanosUnsafe(),
          monotonicTimeNanos: clock.monotonicTimeNanos,
          monotonicTimeNanosUnsafe: () => clock.monotonicTimeNanosUnsafe(),
          sleep: (duration) => clock.sleep(duration),
          currentTimeMillis: Effect.succeed(Date.parse(instant)),
          currentTimeMillisUnsafe: () => Date.parse(instant),
        }),
      );
    const first = yield* openAt(rolling.id, "2026-08-30T14:30:00.000Z");
    const later = yield* openAt(rolling.id, "2026-09-06T14:30:00.000Z");
    expect(first.comparison.current.period).toEqual({
      start: "2026-08-02",
      endExclusive: "2026-09-01",
    });
    expect(later.comparison.current.period).toEqual({
      start: "2026-08-09",
      endExclusive: "2026-09-08",
    });
    const fixedFirst = yield* openAt(fixed.id, "2026-08-30T14:30:00.000Z");
    const fixedLater = yield* openAt(fixed.id, "2026-09-06T14:30:00.000Z");
    expect(fixedFirst.comparison.current.period).toEqual({
      start: "2026-08-01",
      endExclusive: "2026-09-01",
    });
    expect(fixedLater.comparison.current.period).toEqual(fixedFirst.comparison.current.period);
    const monthEnd = yield* openAt(month.id, "2026-08-30T14:30:00.000Z");
    expect(monthEnd.comparison.current.period).toEqual({
      start: "2026-08-01",
      endExclusive: "2026-09-01",
    });
    const nextMonth = yield* openAt(month.id, "2026-08-31T14:30:00.000Z");
    expect(nextMonth.comparison.current.period).toEqual({
      start: "2026-09-01",
      endExclusive: "2026-09-02",
    });
    expect((yield* saved.get({ id: rolling.id })).definition).toEqual(definition);
  }).pipe(Effect.provide(services)),
);

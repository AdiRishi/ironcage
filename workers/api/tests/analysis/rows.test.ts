import { CalendarDate, CommandId, type AnalysisRowsInput } from "@repo/contracts/finance";
import { Crypto, Effect } from "effect";
import { expect } from "vitest";

import { Analysis } from "../../src/analysis/service.ts";
import { Corrections } from "../../src/events/corrections.ts";
import { Events } from "../../src/events/service.ts";
import { Publication } from "../../src/imports/publication.ts";
import { Postings } from "../../src/postings/service.ts";
import { applicationTest } from "../support/application.ts";
import { account, parsed, source, reset } from "../support/fixtures.ts";
const { test, services } = applicationTest();
const commandId = Crypto.Crypto.use((crypto) => crypto.randomUUIDv4).pipe(
  Effect.map((id) => CommandId.make(id)),
);
test(
  "reopening contributor rows after a correction returns the corrected headline and unchanged bank amounts",
  Effect.gen(function* () {
    yield* reset;
    const owner = yield* account(),
      file = yield* source(owner.id);
    const publication = yield* Publication;
    yield* publication.publish({
      ...parsed(["First purchase Card xx1234", "Second purchase Card xx1234"]),
      importId: file.importId,
    });
    const events = yield* Events;
    yield* events.interpret({ commandId: yield* commandId });
    const analysis = yield* Analysis;
    const input: AnalysisRowsInput = {
      query: {
        period: {
          kind: "fixed",
          start: CalendarDate.make("2026-09-01"),
          endExclusive: CalendarDate.make("2026-10-01"),
        },
        comparison: { kind: "previous" },
        basis: "spending",
        currency: "AUD",
        accounts: [owner.id],
        measure: "netPersonalCosts",
        normalization: "total",
        filters: { categories: [], counterparties: [], tags: [], personalEvents: [] },
      },
      groupBy: "category",
      groupKey: "unassigned",
    };
    const before = yield* analysis.rows(input);
    expect(before.rows).toHaveLength(2);
    expect(before.headline.current.total).toEqual({
      kind: "money",
      amount: { currency: "AUD", minor: 900n },
    });
    const [row] = before.rows;
    if (!row?.eventId) return yield* Effect.die("Expected financial event");
    const event = yield* events.get({ eventId: row.eventId });
    const corrections = yield* Corrections;
    yield* corrections.apply({
      commandId: yield* commandId,
      expectedVersions: [{ eventId: event.id, version: event.version }],
      change: {
        eventId: event.id,
        kind: event.kind,
        purchaseOn: CalendarDate.make("2026-08-10"),
        allocations: event.allocations,
      },
    });
    const after = yield* analysis.rows(input);
    expect(after.headline.current.total).toEqual({
      kind: "money",
      amount: { currency: "AUD", minor: 450n },
    });
    expect(after.headline.previous.total).toEqual({
      kind: "money",
      amount: { currency: "AUD", minor: 450n },
    });
    expect(after.rows.filter((item) => item.period === "current")).toHaveLength(1);
    expect(after.rows.filter((item) => item.period === "previous")).toHaveLength(1);
    expect(after.rows.find((item) => item.id === row.id)?.posting.amount.minor).toBe(-450n);
    expect(after.rows.find((item) => item.id === row.id)?.contribution).toEqual({
      kind: "money",
      amount: { currency: "AUD", minor: 450n },
    });
    const postings = yield* Postings;
    expect((yield* postings.get({ postingId: row.posting.id })).posting.postedOn).toBe(
      "2026-09-01",
    );
  }).pipe(Effect.provide(services)),
);

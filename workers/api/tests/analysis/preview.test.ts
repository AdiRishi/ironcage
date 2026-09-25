import { PgClient } from "@effect/sql-pg";
import { CalendarDate, CategoryId, CommandId, EventId } from "@repo/contracts/finance";
import { Crypto, Effect, Schema } from "effect";
import { expect } from "vitest";

import { Flows } from "../../src/analysis/flows.ts";
import { Spending } from "../../src/analysis/spending.ts";
import { Corrections } from "../../src/events/corrections.ts";
import { Events } from "../../src/events/service.ts";
import { Publication } from "../../src/imports/publication.ts";
import { Counterparties } from "../../src/interpretation/counterparties.ts";
import { CounterpartyHistory } from "../../src/interpretation/counterparty-history.ts";
import { applicationTest } from "../support/application.ts";
import { account, createCounterparty, parsedRows, reset, source } from "../support/fixtures.ts";
import { categoryId, populate } from "../support/populated.ts";

const { test, services } = applicationTest();

test(
  "a preview shows each month exactly as the overview shows it once the change is saved",
  Effect.gen(function* () {
    yield* populate;
    const sql = yield* PgClient.PgClient;
    const [row] =
      yield* sql`SELECT e.id FROM events e JOIN postings p ON p.id = e.primary_posting_id WHERE p.description = 'Dinner Place SYDNEY AU Card xx1234'`.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ id: EventId })))),
      );
    const [delivery] = yield* sql`SELECT id FROM categories WHERE slug = 'food.delivery'`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ id: CategoryId })))),
    );
    if (!row || !delivery) return yield* Effect.die("Expected the synthetic dinner");
    const dinner = yield* (yield* Events).get({ eventId: row.id });
    const [allocation] = dinner.allocations;
    // The dinner and its linked repayment move to August together.
    const change = {
      eventId: dinner.id,
      kind: dinner.kind,
      purchaseOn: CalendarDate.make("2026-08-15"),
      allocations: [{ ...allocation, categoryId: delivery.id }],
    } as const;
    const corrections = yield* Corrections;
    const preview = yield* corrections.preview({ change });
    expect(preview.impacts.map((impact) => impact.start)).toEqual(["2026-07-01", "2026-08-01"]);
    expect(preview.impacts[0]?.before.spending.minor).toBe(506450n);
    expect(preview.impacts[0]?.after.spending.minor).toBe(496450n);
    yield* corrections.apply({
      commandId: CommandId.make(yield* Crypto.Crypto.use((crypto) => crypto.randomUUIDv4)),
      change,
      expectedVersions: preview.expectedVersions,
    });
    const flows = yield* Flows;
    for (const impact of preview.impacts) {
      const flow = yield* flows.period({
        period: { kind: "fixed", start: impact.start, endExclusive: impact.endExclusive },
        comparison: { kind: "previous" },
        basis: "spending",
        currency: "AUD",
      });
      expect(impact.after).toMatchObject(flow.totals);
      expect(impact.after.modelShare).toEqual(flow.modelShare);
    }
  }).pipe(Effect.provide(services)),
);

test(
  "a counterparty's amounts are its share of the flow and match the spending screen",
  Effect.gen(function* () {
    yield* populate;
    const period = {
      start: CalendarDate.make("2026-07-01"),
      endExclusive: CalendarDate.make("2026-08-01"),
    };
    const list = (direction: "out" | "in") =>
      Counterparties.use((counterparties) =>
        counterparties.list({ search: "", currency: "AUD", period, direction }),
      );
    const counterparties = yield* list("out");
    const amounts = Object.fromEntries(
      counterparties.map((row) => [row.name, [row.outflow.minor, row.inflow.minor]]),
    );
    expect(amounts).toEqual({
      "Jane Smith": [184000n, 0n],
      Woolworths: [8450n, 0n],
    });
    // John's repayment is linked to the dinner, so it reduces the dinner, not John.
    expect(yield* list("in")).toEqual([]);
    const spending = yield* Spending;
    for (const row of counterparties) {
      const own = yield* spending.breakdown({
        period: { kind: "fixed", ...period },
        comparison: { kind: "previous" },
        basis: "spending",
        currency: "AUD",
        category: { kind: "all" },
        counterparty: { kind: "counterparty", id: row.id },
      });
      expect(own.figures.current).toEqual(row.outflow);
    }
  }).pipe(Effect.provide(services)),
);

test(
  "previewing a counterparty change shows the months it changes and writes nothing",
  Effect.gen(function* () {
    yield* reset;
    const owner = yield* account();
    const file = yield* source(owner.id);
    yield* (yield* Publication).publish({
      ...parsedRows([
        {
          description: "Transfer To Jane Smith NetBank Rent",
          postedOn: "2026-08-01",
          minor: -184000n,
        },
      ]),
      importId: file.importId,
    });
    const jane = yield* createCounterparty({ name: "Jane Smith", kind: "person" }, ["JANE SMITH"]);
    const sql = yield* PgClient.PgClient;
    const facts = sql`SELECT event_id, allocation_id, category_id, measure, amount_minor::text FROM ledger_facts ORDER BY 1, 2`;
    const stored = yield* facts;
    const counterparties = yield* Counterparties;
    const change = {
      kind: "update",
      counterpartyId: jane.id,
      expectedVersion: jane.version,
      fields: {
        name: jane.name,
        kind: jane.kind,
        brand: null,
        defaultCategoryId: yield* categoryId("housing.rent"),
        defaultRole: "purchase",
      },
    } as const;
    const preview = yield* counterparties.preview({ change });
    expect(preview.eventCount).toBe(1);
    expect(
      preview.impacts.map((impact) => [
        impact.start,
        impact.before.spending.minor,
        impact.after.spending.minor,
        impact.before.unresolvedOut.minor,
        impact.after.unresolvedOut.minor,
      ]),
    ).toEqual([["2026-08-01", 0n, 184000n, 184000n, 0n]]);
    expect(yield* facts).toEqual(stored);
    expect((yield* counterparties.get({ counterpartyId: jane.id })).counterparty.version).toBe(1);
    expect(
      (yield* (yield* CounterpartyHistory).list({ counterpartyId: jane.id })).rows,
    ).toHaveLength(1);

    const applied = yield* counterparties.apply({
      commandId: CommandId.make(yield* Crypto.Crypto.use((crypto) => crypto.randomUUIDv4)),
      change,
    });
    const [impact] = preview.impacts;
    if (!impact) return yield* Effect.die("Expected August");
    const flow = yield* (yield* Flows).period({
      period: { kind: "fixed", start: impact.start, endExclusive: impact.endExclusive },
      comparison: { kind: "previous" },
      basis: "spending",
      currency: "AUD",
    });
    expect(impact.after).toMatchObject(flow.totals);

    // Another category of spending changes the transaction and leaves every total.
    const strata = yield* counterparties.preview({
      change: {
        ...change,
        expectedVersion: applied.counterparty.version,
        fields: { ...change.fields, defaultCategoryId: yield* categoryId("housing.strata") },
      },
    });
    expect(strata.eventCount).toBe(1);
    expect(strata.impacts.map((row) => row.after)).toEqual(strata.impacts.map((row) => row.before));
  }).pipe(Effect.provide(services)),
);

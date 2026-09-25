import { PgClient } from "@effect/sql-pg";
import { CalendarDate, CategoryId, CommandId, EventId } from "@repo/contracts/finance";
import { Crypto, Effect, Schema } from "effect";
import { expect } from "vitest";

import { Flows } from "../../src/analysis/flows.ts";
import { Spending } from "../../src/analysis/spending.ts";
import { Corrections } from "../../src/events/corrections.ts";
import { Events } from "../../src/events/service.ts";
import { Counterparties } from "../../src/interpretation/counterparties.ts";
import { applicationTest } from "../support/application.ts";
import { populate } from "../support/populated.ts";

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
    const counterparties = yield* (yield* Counterparties).list({
      search: "",
      currency: "AUD",
      period,
    });
    const amounts = Object.fromEntries(
      counterparties.map((row) => [row.name, [row.outflow.minor, row.inflow.minor]]),
    );
    // John's repayment is linked to the dinner, so it reduces the dinner, not John.
    expect(amounts).toEqual({
      "Jane Smith": [184000n, 0n],
      Woolworths: [8450n, 0n],
      "John Citizen": [0n, 0n],
    });
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

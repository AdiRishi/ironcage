import { PgClient } from "@effect/sql-pg";
import { CommandId } from "@repo/contracts/finance";
import { Crypto, Effect, Schema } from "effect";
import { expect } from "vitest";

import { FactRebuilds } from "../../src/analysis/rebuild.ts";
import { Corrections } from "../../src/events/corrections.ts";
import { Counterparties } from "../../src/interpretation/counterparties.ts";
import { Relationships } from "../../src/relationships/service.ts";
import { applicationTest } from "../support/application.ts";
import { activeEvent, categoryId, populate } from "../support/populated.ts";

const { test, services } = applicationTest();
const commandId = Crypto.Crypto.use((crypto) => crypto.randomUUIDv4).pipe(
  Effect.map((id) => CommandId.make(id)),
);

const spendingIn = Effect.fn(function* (slug: string) {
  const sql = yield* PgClient.PgClient;
  const [row] =
    yield* sql`SELECT COALESCE(sum(f.amount_minor), 0)::text AS total FROM ledger_facts f JOIN categories c ON c.id = f.category_id WHERE c.slug = ${slug} AND f.measure = 'spending'`.pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(Schema.Tuple([Schema.Struct({ total: Schema.String })])),
      ),
    );
  return BigInt(row.total);
});
const snapshot = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;
  return yield* sql`SELECT event_id, allocation_id, credit_event_id, posting_id, account_id, counterparty_id, category_id,
      measure, posted_on::text, spending_on::text, currency, amount_minor::text, purchase, model_assigned
    FROM ledger_facts ORDER BY 1, 2, 3, 8, 12, 10`;
});

const recategoriseDinner = Effect.gen(function* () {
  const dinner = yield* activeEvent("Dinner Place SYDNEY AU Card xx1234");
  const [allocation] = dinner.allocations;
  const corrections = yield* Corrections;
  yield* corrections.apply({
    commandId: yield* commandId,
    expectedVersions: [{ eventId: dinner.id, version: dinner.version }],
    change: {
      eventId: dinner.id,
      kind: dinner.kind,
      purchaseOn: null,
      allocations: [{ ...allocation, categoryId: yield* categoryId("food.delivery") }],
    },
  });
});

test(
  "a linked repayment follows its purchase into a new category",
  Effect.gen(function* () {
    yield* populate;
    expect(yield* spendingIn("food.dining-out")).toBe(10000n);
    yield* recategoriseDinner;
    expect(yield* spendingIn("food.dining-out")).toBe(0n);
    expect(yield* spendingIn("food.delivery")).toBe(10000n);
  }).pipe(Effect.provide(services)),
);

test(
  "facts kept up to date command by command equal facts rebuilt from scratch",
  Effect.gen(function* () {
    yield* populate;
    yield* recategoriseDinner;
    const counterparties = yield* Counterparties;
    const [jane] = (yield* counterparties.list({
      search: "Jane",
      currency: "AUD",
      period: null,
    })).filter((row) => row.name === "Jane Smith");
    if (!jane) return yield* Effect.die("Expected Jane Smith");
    yield* counterparties.save({
      commandId: yield* commandId,
      target: { kind: "update", id: jane.id, expectedVersion: jane.version },
      fields: {
        name: jane.name,
        kind: jane.kind,
        brand: jane.brand,
        defaultCategoryId: yield* categoryId("housing.strata"),
        defaultRole: jane.defaultRole,
      },
    });
    const relationships = yield* Relationships;
    const relate = Effect.fn(function* (
      change: Parameters<(typeof relationships)["preview"]>[0]["change"],
    ) {
      const preview = yield* relationships.preview({ change });
      yield* relationships.apply({
        commandId: yield* commandId,
        change,
        expectedVersions: preview.expectedVersions,
      });
    });
    const settlement = yield* activeEvent("Transfer to xx9999 CommBank app Card");
    yield* relate({ kind: "unlinkMovement", eventId: settlement.id });
    const [purchase] = (yield* activeEvent("MYER SYDNEY AU Card xx1234")).allocations;
    const [refund] = (yield* activeEvent("Refund Purchase MYER SYDNEY")).allocations;
    yield* relate({
      kind: "linkCredit",
      creditAllocationId: refund.id,
      costAllocationId: purchase.id,
      amount: { currency: "AUD", minor: 4000n },
    });
    yield* relate({
      kind: "linkMovement",
      eventId: (yield* activeEvent("Loan Repayment")).id,
      movementKind: "loanPayment",
      counterpart: {
        kind: "event",
        eventId: (yield* activeEvent("Loan Repayment LN REPAY 123456789")).id,
      },
    });

    const incremental = yield* snapshot;
    const sql = yield* PgClient.PgClient;
    yield* sql`UPDATE events SET facts_version = 0`;
    yield* sql`DELETE FROM ledger_facts`;
    const rebuilds = yield* FactRebuilds;
    expect(yield* rebuilds.rebuild).toBe(0);
    expect(yield* snapshot).toEqual(incremental);
  }).pipe(Effect.provide(services)),
);

test(
  "facts built by an older derivation are reported and rebuilt in the background",
  Effect.gen(function* () {
    yield* populate;
    const before = yield* snapshot;
    const sql = yield* PgClient.PgClient;
    yield* sql`UPDATE events SET facts_version = 0`;
    const rebuilds = yield* FactRebuilds;
    expect(yield* rebuilds.status).toEqual({ outdated: 13, rebuilding: true });
    expect(yield* sql`SELECT version FROM fact_rebuilds`).toHaveLength(1);
    expect(yield* rebuilds.rebuild).toBe(0);
    expect(yield* rebuilds.status).toEqual({ outdated: 0, rebuilding: false });
    expect(yield* snapshot).toEqual(before);
  }).pipe(Effect.provide(services)),
);

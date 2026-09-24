import { PgClient } from "@effect/sql-pg";
import {
  AccountId,
  AccountKind,
  CategoryId,
  CounterpartyId,
  CounterpartyKind,
  EventId,
  type FinancialEvent,
} from "@repo/contracts/finance";
import { eventLedgerFacts, factsVersion, type FactLink, type LedgerFact } from "@repo/finance";
import { Array as Arr, Effect, Schema } from "effect";

import { readEvents } from "../events/repository.ts";
import { readCredits } from "../relationships/repository.ts";

const batchSize = 500;

// The facts these events would produce, from their stored inputs or from `links` when a
// preview replaces them.
export const deriveFacts = Effect.fn("deriveFacts")(function* (
  events: readonly FinancialEvent[],
  links?: readonly FactLink[],
) {
  const sql = yield* PgClient.PgClient;
  if (events.length === 0) return [];
  const accounts = yield* sql`SELECT id, kind FROM accounts`.pipe(
    Effect.flatMap(
      Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ id: AccountId, kind: AccountKind }))),
    ),
  );
  const accountKinds = new Map<string, typeof AccountKind.Type>(
    accounts.map((row) => [row.id, row.kind]),
  );
  const categories =
    yield* sql`WITH RECURSIVE tops AS (SELECT id, id AS top FROM categories WHERE parent_id IS NULL
        UNION ALL SELECT c.id, t.top FROM categories c JOIN tops t ON c.parent_id = t.id)
      SELECT id, top FROM tops`.pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(
          Schema.Array(Schema.Struct({ id: CategoryId, top: CategoryId })),
        ),
      ),
    );
  const tops = new Map<string, typeof CategoryId.Type>(categories.map((row) => [row.id, row.top]));
  const counterpartyIds = [
    ...new Set(events.flatMap((event) => (event.counterpartyId ? [event.counterpartyId] : []))),
  ];
  const counterparties =
    counterpartyIds.length === 0
      ? []
      : yield* sql`SELECT id, kind, source FROM counterparties WHERE id = ANY(${counterpartyIds}::uuid[])`.pipe(
          Effect.flatMap(
            Schema.decodeUnknownEffect(
              Schema.Array(
                Schema.Struct({
                  id: CounterpartyId,
                  kind: CounterpartyKind,
                  source: Schema.Literals(["user", "model"]),
                }),
              ),
            ),
          ),
        );
  const touching = links ?? (yield* readCredits(events.map((event) => event.id)));
  return events.flatMap((event) => {
    const allocationIds = new Set<string>(event.allocations.map((allocation) => allocation.id));
    return eventLedgerFacts({
      event,
      accountKinds,
      counterparty: counterparties.find((row) => row.id === event.counterpartyId) ?? null,
      links: touching.filter(
        (link) =>
          allocationIds.has(link.creditAllocationId) || allocationIds.has(link.costAllocationId),
      ),
      topCategory: (id) => tops.get(id) ?? null,
    });
  });
});

// Replaces the stored facts of these events.
export const writeFacts = Effect.fn("writeFacts")(function* (
  eventIds: readonly (typeof EventId.Type)[],
  facts: readonly LedgerFact[],
) {
  const sql = yield* PgClient.PgClient;
  yield* sql`DELETE FROM ledger_facts WHERE event_id = ANY(${eventIds}::uuid[])`;
  for (const rows of Arr.chunksOf(facts, 1000))
    yield* sql`INSERT INTO ledger_facts ${sql.insert(
      rows.map((fact) => ({
        event_id: fact.eventId,
        allocation_id: fact.allocationId,
        account_id: fact.accountId,
        counterparty_id: fact.counterpartyId,
        category_id: fact.categoryId,
        top_category_id: fact.topCategoryId,
        measure: fact.measure,
        posted_on: fact.postedOn,
        spending_on: fact.spendingOn,
        currency: fact.currency,
        amount_minor: fact.amountMinor,
        purchase: fact.purchase,
        model_assigned: fact.modelAssigned,
      })),
    )}`;
});

// Rebuilds the facts of these events from what is stored, and records the version that
// built them.
export const refreshFacts = Effect.fn("refreshFacts")(function* (
  eventIds: readonly (typeof EventId.Type)[],
) {
  const sql = yield* PgClient.PgClient;
  for (const ids of Arr.chunksOf(eventIds, batchSize)) {
    yield* writeFacts(ids, yield* deriveFacts(yield* readEvents(ids)));
    yield* sql`UPDATE events SET facts_version = ${factsVersion} WHERE id = ANY(${ids}::uuid[])`;
  }
  return eventIds.length;
});

// Rebuilds the facts of every event this transaction's statements changed, as noted by
// the triggers in migration 0022. A write transaction runs this before it commits, so a
// committed write leaves no fact behind.
export const refreshNotedFacts = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;
  const noted =
    yield* sql`SELECT DISTINCT unnest(string_to_array(NULLIF(current_setting('ironcage.fact_events', true), ''), ','))::uuid AS id ORDER BY id`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ id: EventId })))),
    );
  if (noted.length === 0) return 0;
  yield* refreshFacts(noted.map((row) => row.id));
  yield* sql`SELECT set_config('ironcage.fact_events', '', true)`;
  return noted.length;
});

// Events whose facts an older derivation built.
export const outdatedFacts = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;
  const [row] =
    yield* sql`SELECT count(*)::int AS count FROM events WHERE facts_version < ${factsVersion}`.pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(Schema.Tuple([Schema.Struct({ count: Schema.Int })])),
      ),
    );
  return row.count;
});

// Rebuilds one batch of outdated facts and reports how many remain.
export const rebuildOutdatedFacts = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;
  const ids =
    yield* sql`SELECT id FROM events WHERE facts_version < ${factsVersion} ORDER BY id LIMIT ${batchSize}`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ id: EventId })))),
    );
  yield* refreshFacts(ids.map((row) => row.id));
  return yield* outdatedFacts;
});

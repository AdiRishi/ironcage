import { PgClient } from "@effect/sql-pg";
import {
  AccountId,
  AccountKind,
  AllocationId,
  CalendarDate,
  CategoryId,
  CounterpartyId,
  CounterpartyKind,
  EventId,
} from "@repo/contracts/finance";
import { eventLedgerFacts } from "@repo/finance";
import { Array as Arr, Effect, Schema } from "effect";

import { readEvents } from "../events/repository.ts";

const CreditRow = Schema.Struct({
  creditAllocationId: AllocationId,
  amountMinor: Schema.BigIntFromString,
  categoryId: Schema.NullOr(CategoryId),
  accountId: AccountId,
  postedOn: CalendarDate,
  spendingOn: CalendarDate,
  counterpartyId: Schema.NullOr(CounterpartyId),
});

// Rewrites ledger facts for every event a trigger marked stale. Runs at the end of
// each command, inside its transaction, so a committed change is always projected.
export const refreshStaleFacts = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;
  const stale = yield* sql`SELECT id FROM events WHERE facts_stale ORDER BY id`.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ id: EventId })))),
  );
  if (stale.length === 0) return 0;
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
  for (const batch of Arr.chunksOf(stale, 500)) {
    const ids = batch.map((row) => row.id);
    const events = yield* readEvents(ids);
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
    const credits =
      yield* sql`SELECT c.credit_allocation_id AS "creditAllocationId", c.amount_minor::text AS "amountMinor",
          cost.category_id AS "categoryId", e.reporting_account_id AS "accountId", p.posted_on::text AS "postedOn",
          (CASE WHEN e.kind = 'purchase' AND e.purchase_on IS NOT NULL THEN e.purchase_on ELSE p.posted_on END)::text AS "spendingOn",
          e.counterparty_id AS "counterpartyId"
        FROM credit_links c JOIN allocations credit ON credit.id = c.credit_allocation_id
        JOIN allocations cost ON cost.id = c.cost_allocation_id JOIN events e ON e.id = cost.event_id
        JOIN postings p ON p.id = e.primary_posting_id
        WHERE credit.event_id = ANY(${ids}::uuid[])`.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(CreditRow))),
      );
    const facts = events.flatMap((event) => {
      const counterparty = counterparties.find((row) => row.id === event.counterpartyId) ?? null;
      return eventLedgerFacts({
        event,
        accountKinds,
        counterparty,
        credits: credits.filter((credit) =>
          event.allocations.some((allocation) => allocation.id === credit.creditAllocationId),
        ),
        topCategory: (id) => tops.get(id) ?? null,
      });
    });
    yield* sql`DELETE FROM ledger_facts WHERE event_id = ANY(${ids}::uuid[])`;
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
          amount_minor: fact.amountMinor.toString(),
          purchase: fact.purchase,
          model_assigned: fact.modelAssigned,
        })),
      )}`;
    yield* sql`UPDATE events SET facts_stale = false WHERE id = ANY(${ids}::uuid[])`;
  }
  return stale.length;
});

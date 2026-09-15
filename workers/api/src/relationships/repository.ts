import { PgClient } from "@effect/sql-pg";
import {
  CreditLink,
  EventId,
  FeeAssociation,
  FinancialEvent,
  FinanceError,
  MovementLink,
  type AllocationId,
} from "@repo/contracts/finance";
import { remainingAllocation } from "@repo/finance";
import { Effect, Schema } from "effect";

import { money } from "../database/columns.ts";
import { readEvent } from "../events/repository.ts";

export const readCredits = Effect.fn("readCredits")(function* () {
  const sql = yield* PgClient.PgClient;
  return yield* sql`SELECT l.id, l.credit_allocation_id AS "creditAllocationId", l.cost_allocation_id AS "costAllocationId", c.event_id AS "creditEventId", a.event_id AS "costEventId", ${money(sql, "e.currency", "l.amount_minor")} AS amount FROM credit_links l JOIN allocations c ON c.id=l.credit_allocation_id JOIN allocations a ON a.id=l.cost_allocation_id JOIN events e ON e.id=c.event_id`.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(CreditLink))),
  );
});
export const readMovement = Effect.fn("readMovement")(function* (eventId: typeof EventId.Type) {
  const sql = yield* PgClient.PgClient;
  const rows =
    yield* sql`SELECT event_id AS "eventId", from_endpoint AS "from", to_endpoint AS "to", evidence, absorbed_event_id AS "absorbedEventId", original_event AS original FROM movement_links WHERE event_id=${eventId}`.pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(
          Schema.Array(Schema.Struct({ ...MovementLink.fields, original: FinancialEvent })),
        ),
      ),
    );
  return rows[0] ?? null;
});
export const readFees = Effect.fn("readFees")(function* (eventId: typeof EventId.Type) {
  const sql = yield* PgClient.PgClient;
  return yield* sql`SELECT fee_event_id AS "feeEventId", purchase_event_id AS "purchaseEventId", status FROM fee_associations WHERE fee_event_id=${eventId} OR purchase_event_id=${eventId}`.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(FeeAssociation))),
  );
});
export const allocationEvent = Effect.fn("allocationEvent")(function* (
  allocationId: typeof AllocationId.Type,
) {
  const sql = yield* PgClient.PgClient;
  const [row] = yield* sql`SELECT event_id AS id FROM allocations WHERE id=${allocationId}`.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ id: EventId })))),
  );
  if (!row) return yield* new FinanceError({ kind: "notFound", message: "Allocation not found." });
  return yield* readEvent(row.id);
});
export const readRelationships = Effect.fn("readRelationships")(function* (
  eventId: typeof EventId.Type,
) {
  const event = yield* readEvent(eventId);
  const links = (yield* readCredits()).filter(
    (link) => link.creditEventId === eventId || link.costEventId === eventId,
  );
  return {
    movement: yield* readMovement(eventId),
    credits: links,
    fees: yield* readFees(eventId),
    remaining: event.allocations.map((allocation) => ({
      allocationId: allocation.id,
      amount: {
        currency: event.magnitude.currency,
        minor: remainingAllocation(event, allocation.id, links),
      },
    })),
  };
});

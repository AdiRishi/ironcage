import { PgClient } from "@effect/sql-pg";
import {
  EventId,
  FinancialEvent,
  FinanceError,
  Allocation,
  Posting,
} from "@repo/contracts/finance";
import { Effect, Schema, Struct } from "effect";

import { money, postingFields } from "../database/columns.ts";

export const readEvents = Effect.fn("readEvents")(function* (
  eventIds: readonly (typeof EventId.Type)[],
) {
  if (eventIds.length === 0) return [];
  const sql = yield* PgClient.PgClient;
  const events =
    yield* sql`SELECT id, kind, role_source AS "roleSource", counterparty_id AS "counterpartyId",
    counterparty_source AS "counterpartySource", ${money(sql, "currency", "magnitude_minor")} AS magnitude,
    primary_posting_id AS "primaryPostingId", reporting_account_id AS "reportingAccountId",
    purchase_on::text AS "purchaseOn", active, version FROM events WHERE id = ANY(${eventIds}::uuid[])`.pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(
          Schema.Array(
            Schema.Struct({
              ...Struct.omit(FinancialEvent.fields, ["allocations", "postings"]),
            }),
          ),
        ),
      ),
    );
  const allocations =
    yield* sql`SELECT al.event_id AS "eventId", al.id, al.role, ${money(sql, "e.currency", "al.amount_minor")} AS amount,
    al.category_id AS "categoryId", al.category_source AS "categorySource", al.non_personal AS "nonPersonal",
    ARRAY(SELECT tag_id FROM allocation_tags WHERE allocation_id = al.id ORDER BY tag_id) AS "tagIds",
    ARRAY(SELECT personal_event_id FROM allocation_personal_events WHERE allocation_id = al.id ORDER BY personal_event_id) AS "personalEventIds"
    FROM allocations al JOIN events e ON e.id = al.event_id WHERE al.event_id = ANY(${eventIds}::uuid[]) ORDER BY al.id`.pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(
          Schema.Array(Schema.Struct({ ...Allocation.fields, eventId: EventId })),
        ),
      ),
    );
  const postings =
    yield* sql`SELECT ep.event_id AS "eventId", ${postingFields(sql)} FROM postings p JOIN accounts a ON a.id = p.account_id
    JOIN event_postings ep ON ep.posting_id = p.id WHERE ep.event_id = ANY(${eventIds}::uuid[]) ORDER BY p.posted_on, p.id`.pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(
          Schema.Array(Schema.Struct({ ...Posting.fields, eventId: EventId })),
        ),
      ),
    );
  const allocationGroups = new Map<typeof EventId.Type, (typeof allocations)[number][]>();
  for (const allocation of allocations) {
    const group = allocationGroups.get(allocation.eventId) ?? [];
    group.push(allocation);
    allocationGroups.set(allocation.eventId, group);
  }
  const postingGroups = new Map<typeof EventId.Type, (typeof postings)[number][]>();
  for (const posting of postings) {
    const group = postingGroups.get(posting.eventId) ?? [];
    group.push(posting);
    postingGroups.set(posting.eventId, group);
  }
  return yield* Effect.forEach(events, (event) =>
    Effect.gen(function* () {
      const [first, ...rest] = allocationGroups.get(event.id) ?? [];
      if (!first) return yield* Effect.die("Stored event has no allocations");
      return {
        ...event,
        allocations: [
          Struct.omit(first, ["eventId"]),
          ...rest.map((row) => Struct.omit(row, ["eventId"])),
        ],
        postings: (postingGroups.get(event.id) ?? []).map((row) => Struct.omit(row, ["eventId"])),
      } satisfies FinancialEvent;
    }),
  );
});

export const readEvent = Effect.fn("readEvent")(function* (eventId: typeof EventId.Type) {
  const [event] = yield* readEvents([eventId]);
  if (!event)
    return yield* new FinanceError({ kind: "notFound", message: "Financial event not found." });
  return event;
});

import { PgClient } from "@effect/sql-pg";
import { EventId, FinancialEvent, FinanceError } from "@repo/contracts/finance";
import { Effect, Schema, Struct } from "effect";

import { money, postingFields } from "../database/columns.ts";

export const readEvent = Effect.fn("readEvent")(function* (eventId: typeof EventId.Type) {
  const sql = yield* PgClient.PgClient;
  const [event] =
    yield* sql`SELECT id, kind, ${money(sql, "currency", "magnitude_minor")} AS magnitude,
    primary_posting_id AS "primaryPostingId", reporting_account_id AS "reportingAccountId",
    purchase_on::text AS "purchaseOn", active, version FROM events WHERE id = ${eventId}`.pipe(
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
  if (!event)
    return yield* new FinanceError({ kind: "notFound", message: "Financial event not found." });
  const allocations =
    yield* sql`SELECT al.id, al.role, ${money(sql, "e.currency", "al.amount_minor")} AS amount,
    al.category_id AS "categoryId", al.merchant_id AS "merchantId", al.non_personal AS "nonPersonal",
    ARRAY(SELECT tag_id FROM allocation_tags WHERE allocation_id = al.id ORDER BY tag_id) AS "tagIds",
    ARRAY(SELECT personal_event_id FROM allocation_personal_events WHERE allocation_id = al.id ORDER BY personal_event_id) AS "personalEventIds"
    FROM allocations al JOIN events e ON e.id = al.event_id WHERE al.event_id = ${eventId} ORDER BY al.id`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(FinancialEvent.fields.allocations)),
    );
  const postings =
    yield* sql`SELECT ${postingFields(sql)} FROM postings p JOIN accounts a ON a.id = p.account_id
    JOIN event_postings ep ON ep.posting_id = p.id WHERE ep.event_id = ${eventId} ORDER BY p.posted_on, p.id`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(FinancialEvent.fields.postings)),
    );
  return { ...event, allocations, postings };
});

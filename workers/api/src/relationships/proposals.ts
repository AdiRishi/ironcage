import { PgClient } from "@effect/sql-pg";
import {
  AllocationId,
  CalendarDate,
  CounterpartyId,
  EventId,
  Money,
} from "@repo/contracts/finance";
import { creditProposals } from "@repo/finance";
import { Effect, Schema } from "effect";

export const proposeMovements = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;
  yield* sql`INSERT INTO review_items(id,kind,observation_ids,event_ids,question,candidates)
    SELECT gen_random_uuid(),'relationship','{}',ARRAY[e.id,f.id],'{"kind":"movement","message":"Confirm whether these postings are two sides of one movement."}','[]'
    FROM events e JOIN postings p ON p.id=e.primary_posting_id
    JOIN postings q ON q.currency=p.currency AND q.amount_minor=-p.amount_minor AND q.account_id<>p.account_id AND q.posted_on BETWEEN p.posted_on-3 AND p.posted_on+3
    JOIN events f ON f.primary_posting_id=q.id AND f.active
    WHERE e.active AND e.id<f.id AND e.kind IN ('transfer','cardSettlement','loanPayment','borrowing','unresolved') AND f.kind IN ('transfer','cardSettlement','loanPayment','borrowing','unresolved') AND (e.kind<>'unresolved' OR f.kind<>'unresolved')
    AND NOT EXISTS(SELECT 1 FROM movement_links m WHERE m.event_id IN (e.id,f.id))
    AND NOT EXISTS(SELECT 1 FROM review_items r WHERE r.kind='relationship' AND r.event_ids @> ARRAY[e.id,f.id])`;
});

// Remaining amounts subtract every credit link that already uses the allocation.
const remaining = (sql: PgClient.PgClient) =>
  sql`al.amount_minor - COALESCE((SELECT sum(l.amount_minor) FROM credit_links l WHERE al.id IN (l.credit_allocation_id, l.cost_allocation_id)), 0)`;

// Proposes the purchase each unlinked refund or repayment most likely returns, once per
// credit: a credit that was proposed before, including a dismissed proposal, is left
// alone. Nothing is linked until you accept.
export const proposeCredits = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;
  const credits =
    yield* sql`SELECT e.id AS "eventId", al.id AS "allocationId", al.role AS kind, e.counterparty_id AS "counterpartyId",
        d.alias_key AS "aliasKey", d.reference, p.posted_on::text AS "postedOn",
        jsonb_build_object('currency', e.currency, 'minor', (${remaining(sql)})::text) AS remaining
      FROM events e JOIN allocations al ON al.event_id = e.id JOIN postings p ON p.id = e.primary_posting_id
      LEFT JOIN posting_descriptors d ON d.posting_id = p.id
      WHERE e.active AND al.role IN ('refund', 'reimbursement') AND ${remaining(sql)} > 0
        AND NOT EXISTS (SELECT 1 FROM review_items r WHERE r.kind = 'relationship'
          AND r.question->>'kind' = 'credit' AND e.id = r.event_ids[1])`.pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(
          Schema.Array(
            Schema.Struct({
              eventId: EventId,
              allocationId: AllocationId,
              kind: Schema.Literals(["refund", "reimbursement"]),
              counterpartyId: Schema.NullOr(CounterpartyId),
              aliasKey: Schema.NullOr(Schema.String),
              reference: Schema.NullOr(Schema.String),
              postedOn: CalendarDate,
              remaining: Money,
            }),
          ),
        ),
      ),
    );
  const [earliest] = credits.map((credit) => credit.postedOn).toSorted();
  if (!earliest) return;
  const costs =
    yield* sql`SELECT e.id AS "eventId", al.id AS "allocationId", e.counterparty_id AS "counterpartyId",
        d.alias_key AS "aliasKey", p.description,
        (CASE WHEN e.purchase_on IS NOT NULL THEN e.purchase_on ELSE p.posted_on END)::text AS "spendingOn",
        jsonb_build_object('currency', e.currency, 'minor', (${remaining(sql)})::text) AS remaining
      FROM events e JOIN allocations al ON al.event_id = e.id JOIN postings p ON p.id = e.primary_posting_id
      LEFT JOIN posting_descriptors d ON d.posting_id = p.id
      WHERE e.active AND e.kind = 'purchase' AND al.role = 'purchase' AND NOT al.non_personal
        AND ${remaining(sql)} > 0 AND p.posted_on >= ${earliest}::date - 130`.pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(
          Schema.Array(
            Schema.Struct({
              eventId: EventId,
              allocationId: AllocationId,
              counterpartyId: Schema.NullOr(CounterpartyId),
              aliasKey: Schema.NullOr(Schema.String),
              description: Schema.String,
              spendingOn: CalendarDate,
              remaining: Money,
            }),
          ),
        ),
      ),
    );
  const proposals = creditProposals({ credits, costs });
  if (proposals.length === 0) return;
  const rows = proposals.map(({ amount, ...proposal }) => ({
    ...proposal,
    currency: amount.currency,
    minor: amount.minor.toString(),
  }));
  yield* sql`INSERT INTO review_items (id, kind, observation_ids, event_ids, question, candidates)
    SELECT gen_random_uuid(), 'relationship', '{}', ARRAY[x."creditEventId", x."costEventId"],
      '{"kind":"credit","message":"Confirm whether this credit returns this purchase."}',
      jsonb_build_array(jsonb_build_object('creditAllocationId', x."creditAllocationId", 'costAllocationId', x."costAllocationId",
        'amount', jsonb_build_object('currency', x.currency, 'minor', x.minor)))
    FROM jsonb_to_recordset(${sql.json(rows)}) AS x("creditEventId" uuid, "costEventId" uuid,
      "creditAllocationId" uuid, "costAllocationId" uuid, currency text, minor text)`;
});

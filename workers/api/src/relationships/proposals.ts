import { PgClient } from "@effect/sql-pg";
import { Effect } from "effect";
export const proposeMovements = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;
  yield* sql`INSERT INTO review_items(id,kind,observation_ids,event_ids,question,candidates)
    SELECT gen_random_uuid(),'relationship','{}',ARRAY[e.id,f.id],'{"message":"Confirm whether these postings are two sides of one movement."}','[]'
    FROM events e JOIN postings p ON p.id=e.primary_posting_id
    JOIN postings q ON q.currency=p.currency AND q.amount_minor=-p.amount_minor AND q.account_id<>p.account_id AND q.posted_on BETWEEN p.posted_on-3 AND p.posted_on+3
    JOIN events f ON f.primary_posting_id=q.id AND f.active
    WHERE e.active AND e.id<f.id AND e.kind IN ('transfer','cardSettlement','loanPayment','borrowing','unresolved') AND f.kind IN ('transfer','cardSettlement','loanPayment','borrowing','unresolved') AND (e.kind<>'unresolved' OR f.kind<>'unresolved')
    AND NOT EXISTS(SELECT 1 FROM movement_links m WHERE m.event_id IN (e.id,f.id))
    AND NOT EXISTS(SELECT 1 FROM review_items r WHERE r.kind='relationship' AND r.event_ids @> ARRAY[e.id,f.id])`;
});

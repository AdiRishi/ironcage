import { PgClient } from "@effect/sql-pg";
import { EventId, FinancialEvent, Rule, RuleId } from "@repo/contracts/finance";
import { Effect, Schema } from "effect";
export const readRules = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;
  return yield* sql`SELECT id,name,conditions,action,scope,version FROM rules ORDER BY name,id`.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Rule))),
  );
});
export const ruleApplications = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;
  return yield* sql`SELECT event_id AS "eventId",applied_rules AS rules,prior FROM rule_applications`.pipe(
    Effect.flatMap(
      Schema.decodeUnknownEffect(
        Schema.Array(
          Schema.Struct({ eventId: EventId, rules: Schema.Array(Rule), prior: FinancialEvent }),
        ),
      ),
    ),
  );
});
export const ruleExceptions = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;
  return yield* sql`SELECT rule_id AS "ruleId",event_id AS "eventId" FROM rule_exceptions`.pipe(
    Effect.flatMap(
      Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ ruleId: RuleId, eventId: EventId }))),
    ),
  );
});
export const protectedEvents = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;
  const rows =
    yield* sql`SELECT e.id FROM events e WHERE EXISTS(SELECT 1 FROM corrections c WHERE c.event_id=e.id AND c.scope<>'rule') OR EXISTS(SELECT 1 FROM movement_links m WHERE m.event_id=e.id) OR EXISTS(SELECT 1 FROM credit_links c JOIN allocations a ON a.id=c.credit_allocation_id OR a.id=c.cost_allocation_id WHERE a.event_id=e.id) OR EXISTS(SELECT 1 FROM fee_associations f WHERE e.id IN (f.fee_event_id,f.purchase_event_id))`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ id: EventId })))),
    );
  return new Set(rows.map((row) => row.id));
});

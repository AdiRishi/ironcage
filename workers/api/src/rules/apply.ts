import { PgClient } from "@effect/sql-pg";
import { type CommandId, FinancialEvent } from "@repo/contracts/finance";
import { Array as Arr, Effect, Schema } from "effect";

import { planRules } from "./plan.ts";

export const writeRulePlan = Effect.fn("writeRulePlan")(function* (
  plan: Effect.Success<ReturnType<typeof planRules>>,
  commandId: typeof CommandId.Type,
) {
  const sql = yield* PgClient.PgClient;
  for (const batch of Arr.chunksOf(plan.changes, 250)) {
    const payload = yield* Effect.forEach(
      batch,
      Effect.fn(function* (change) {
        return {
          eventId: change.prior.id,
          kind: change.accepted.kind,
          purchaseOn: change.accepted.purchaseOn,
          version: change.accepted.version,
          allocationId: change.accepted.allocations[0].id,
          role: change.accepted.allocations[0].role,
          categoryId: change.accepted.allocations[0].categoryId,
          rules: change.rules,
          prior: yield* Schema.encodeEffect(Schema.toCodecJson(FinancialEvent))(change.prior),
          accepted: yield* Schema.encodeEffect(Schema.toCodecJson(FinancialEvent))(change.accepted),
          base: yield* Schema.encodeEffect(Schema.toCodecJson(FinancialEvent))(change.base),
        };
      }),
    );
    const records = sql`jsonb_to_recordset(${sql.json({ rows: payload })}::jsonb->'rows') AS x("eventId" uuid,kind text,"purchaseOn" date,version integer,"allocationId" uuid,role text,"categoryId" uuid,rules jsonb,prior jsonb,accepted jsonb,base jsonb)`;
    yield* sql`UPDATE events e SET kind=x.kind,purchase_on=x."purchaseOn",version=x.version,suggestion=NULL FROM ${records} WHERE e.id=x."eventId"`;
    yield* sql`UPDATE allocations a SET role=x.role,category_id=x."categoryId" FROM ${records} WHERE a.id=x."allocationId"`;
    yield* sql`INSERT INTO corrections(id,event_id,command_id,prior,accepted,scope) SELECT gen_random_uuid(),x."eventId",${commandId}::uuid,x.prior,x.accepted,'rule' FROM ${records}`;
    yield* sql`DELETE FROM rule_applications WHERE ${sql.in(
      "event_id",
      batch.map((change) => change.prior.id),
    )}`;
    yield* sql`INSERT INTO rule_applications(event_id,applied_rules,prior) SELECT x."eventId",x.rules,x.base FROM ${records} WHERE jsonb_array_length(x.rules)>0`;
    yield* sql`UPDATE review_items SET resolved_at=now(),resolution='{"kind":"rule"}',version=version+1 WHERE kind IN ('role','ruleConflict') AND event_ids && ARRAY(SELECT x."eventId" FROM ${records}) AND resolved_at IS NULL`;
    yield* sql`INSERT INTO review_items(id,kind,event_ids,observation_ids,question,candidates) SELECT gen_random_uuid(),'role',ARRAY[x."eventId"],'{}','{"message":"Choose the financial role."}','[]' FROM ${records} WHERE x.kind='unresolved'`;
  }
  for (const eventId of plan.conflicts)
    yield* sql`INSERT INTO review_items(id,kind,event_ids,observation_ids,question,candidates) SELECT gen_random_uuid(),'ruleConflict',ARRAY[${eventId}::uuid],'{}','{"message":"Two matching rules disagree. Correct the event or change the rules."}','[]' WHERE NOT EXISTS(SELECT 1 FROM review_items WHERE kind='ruleConflict' AND ${eventId}::uuid=ANY(event_ids) AND resolved_at IS NULL)`;
});

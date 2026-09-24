import { PgClient } from "@effect/sql-pg";
import { EventId, Rule, RuleId } from "@repo/contracts/finance";
import { Effect, Schema } from "effect";

export const readRules = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;
  return yield* sql`SELECT id,name,conditions,action,scope,version FROM rules ORDER BY name,id`.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Rule))),
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

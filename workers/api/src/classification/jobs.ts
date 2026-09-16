import { PgClient } from "@effect/sql-pg";
import {
  ClassificationBatch,
  CommandId,
  ClassificationInput,
  ClassificationItem,
  ClassificationRun,
  ClassificationRunId,
  EventId,
  FinanceError,
  ReferenceData,
  SuggestCategories,
  UpdateClassificationSettings,
} from "@repo/contracts/finance";
import { Crypto, Effect, Schema } from "effect";

import { Commands } from "../database/commands.ts";
import { ClassificationJobs } from "../platform/services.ts";
import { protectedEvents } from "../rules/repository.ts";
import { ensureClassificationEnabled, readClassificationRun } from "./repository.ts";

export const requestClassification = Effect.fn("requestClassification")(function* (
  input: typeof SuggestCategories.Type,
) {
  const sql = yield* PgClient.PgClient;
  const commands = yield* Commands;
  const jobs = yield* ClassificationJobs;
  const run = yield* commands.run({
    commandId: input.commandId,
    input: { operation: "suggestCategories", ...input },
    result: Schema.toCodecJson(ClassificationRun),
    execute: Effect.gen(function* () {
      const provider = yield* ensureClassificationEnabled;
      const protectedIds = yield* protectedEvents;
      const scope = input.eventIds === "all" ? sql`true` : sql.in("e.id", input.eventIds);
      const rows =
        yield* sql`SELECT e.id,e.version FROM events e WHERE e.active AND ${scope} AND (SELECT count(*) FROM allocations a WHERE a.event_id=e.id)=1 AND NOT EXISTS(SELECT 1 FROM allocations a WHERE a.event_id=e.id AND a.category_id IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM rule_applications r WHERE r.event_id=e.id) ORDER BY e.id`.pipe(
          Effect.flatMap(
            Schema.decodeUnknownEffect(
              Schema.Array(Schema.Struct({ id: EventId, version: Schema.Int })),
            ),
          ),
        );
      const eligible = rows.filter((row) => !protectedIds.has(row.id));
      const id = ClassificationRunId.make(input.commandId);
      yield* sql`INSERT INTO classification_runs(id,status,model,requested) VALUES (${id},${eligible.length ? "pending" : "completed"},${provider.model},${eligible.length})`;
      if (eligible.length)
        yield* sql`INSERT INTO classification_items ${sql.insert(eligible.map((event) => ({ run_id: id, event_id: event.id, event_version: event.version })))}`;
      return yield* readClassificationRun(id);
    }),
  });
  if (run.requested > 0) yield* jobs.start({ runId: run.id });
  return run;
});
export const updateClassificationSettings = Effect.fn("updateClassificationSettings")(function* (
  input: typeof UpdateClassificationSettings.Type,
) {
  const sql = yield* PgClient.PgClient;
  const commands = yield* Commands;
  if (input.warning && (input.warning.currency !== "USD" || input.warning.minor <= 0n))
    return yield* new FinanceError({
      kind: "invalid",
      message: "Use a positive USD usage threshold.",
    });
  return yield* commands.run({
    commandId: input.commandId,
    input: {
      operation: "updateClassificationSettings",
      input: yield* Schema.encodeEffect(Schema.toCodecJson(UpdateClassificationSettings))(input),
    },
    result: Schema.Boolean,
    execute: Effect.gen(function* () {
      const rows =
        yield* sql`UPDATE classification_settings SET enabled=${input.enabled},warning_minor=${input.warning?.minor.toString() ?? null},version=version+1 WHERE id=1 AND version=${input.expectedVersion} RETURNING id`;
      if (!rows.length)
        return yield* new FinanceError({
          kind: "stale",
          message: "Classification settings changed. Refresh before saving.",
        });
      return true;
    }),
  });
});
export const nextClassificationBatch = Effect.fn("nextClassificationBatch")(function* ({
  runId,
}: typeof ClassificationInput.Type) {
  const sql = yield* PgClient.PgClient;
  return yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`;
      const run = yield* readClassificationRun(runId);
      const provider = yield* ensureClassificationEnabled;
      if (run.model !== provider.model)
        return yield* new FinanceError({
          kind: "unavailable",
          message: "The configured model changed. Start a new suggestion run.",
        });
      const items =
        run.status === "completed" || run.status === "failed"
          ? []
          : yield* sql`SELECT i.event_id AS "eventId",i.event_version AS "eventVersion",left(p.description,1000) AS description,e.kind AS role,a.kind AS "accountKind",m.name AS merchant FROM classification_items i JOIN events e ON e.id=i.event_id JOIN postings p ON p.id=e.primary_posting_id JOIN accounts a ON a.id=p.account_id LEFT JOIN LATERAL (SELECT merchant_id FROM allocations WHERE event_id=e.id ORDER BY id LIMIT 1) al ON true LEFT JOIN merchants m ON m.id=al.merchant_id WHERE i.run_id=${runId} AND i.status='pending' ORDER BY i.event_id LIMIT 20`.pipe(
              Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(ClassificationItem))),
            );
      const categories =
        yield* sql`SELECT id,parent_id AS "parentId",name,archived,version FROM categories WHERE NOT archived ORDER BY name,id`.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(ReferenceData.fields.categories)),
        );
      return {
        commandId: CommandId.make(yield* Crypto.Crypto.use((crypto) => crypto.randomUUIDv4)),
        runId,
        items,
        categories,
        provider,
      } satisfies typeof ClassificationBatch.Type;
    }),
  );
});

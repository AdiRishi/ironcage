import { PgClient } from "@effect/sql-pg";
import {
  AcceptanceSummary,
  AcceptSuggestions,
  CategorySuggestion,
  CompleteClassificationBatch,
  FailClassification,
  FinanceError,
  SuggestionList,
} from "@repo/contracts/finance";
import { DateTime, Effect, Schema } from "effect";

import { Commands } from "../database/commands.ts";
import { recordCorrection, writeEvent } from "../events/correction-records.ts";
import { readEvent } from "../events/repository.ts";
import { protectedEvents } from "../rules/repository.ts";
import { readClassificationRun } from "./repository.ts";
export const completeClassificationBatch = Effect.fn("completeClassificationBatch")(function* (
  input: typeof CompleteClassificationBatch.Type,
) {
  const sql = yield* PgClient.PgClient;
  const commands = yield* Commands;
  return yield* commands.run({
    commandId: input.commandId,
    input: {
      operation: "completeClassificationBatch",
      input: yield* Schema.encodeEffect(Schema.toCodecJson(CompleteClassificationBatch))(input),
    },
    result: Schema.Boolean,
    execute: Effect.gen(function* () {
      const run = yield* readClassificationRun(input.runId);
      const report = input.report;
      const ids = new Set(input.expectedVersions.map((row) => row.eventId));
      if (
        report.status === "success" &&
        (report.results.length !== ids.size ||
          new Set(report.results.map((row) => row.eventId)).size !== ids.size ||
          report.results.some((row) => !ids.has(row.eventId)))
      )
        return yield* new FinanceError({
          kind: "invalid",
          message: "The classification result does not match its batch.",
        });
      yield* sql`INSERT INTO model_usage(id,task,model,input_tokens,output_tokens,cost_minor,cost_currency,status) VALUES (${input.commandId},'classification',${run.model},${report.inputTokens?.toString() ?? null},${report.outputTokens?.toString() ?? null},${report.cost?.minor.toString() ?? null},${report.cost?.currency ?? null},${report.status})`;
      const protectedIds = yield* protectedEvents;
      const createdAt = DateTime.formatIso(yield* DateTime.now);
      for (const expected of input.expectedVersions) {
        const [item] =
          yield* sql`SELECT event_version AS version,status FROM classification_items WHERE run_id=${run.id} AND event_id=${expected.eventId}`.pipe(
            Effect.flatMap(
              Schema.decodeUnknownEffect(
                Schema.Array(Schema.Struct({ version: Schema.Int, status: Schema.String })),
              ),
            ),
          );
        if (!item || item.version !== expected.version)
          return yield* new FinanceError({
            kind: "invalid",
            message: "The classification item does not match the requested version.",
          });
        if (item.status !== "pending") continue;
        const event = yield* readEvent(expected.eventId);
        const result = report.results.find((row) => row.eventId === event.id);
        const acceptedRules =
          yield* sql`SELECT event_id FROM rule_applications WHERE event_id=${event.id}`;
        const categoryValid =
          !result?.categoryId ||
          (yield* sql`SELECT id FROM categories WHERE id=${result.categoryId} AND NOT archived`)
            .length > 0;
        const eligible =
          report.status === "success" &&
          result &&
          categoryValid &&
          event.active &&
          event.version === expected.version &&
          event.allocations.length === 1 &&
          event.allocations[0].categoryId === null &&
          !protectedIds.has(event.id) &&
          !acceptedRules.length;
        if (eligible) {
          const suggestion = {
            eventVersion: event.version + 1,
            categoryId: result.categoryId,
            reason: result.reason,
            model: run.model,
            createdAt,
          };
          yield* sql`UPDATE events SET suggestion=${sql.json(suggestion)},version=version+1 WHERE id=${event.id}`;
        }
        yield* sql`UPDATE classification_items SET status=${report.status === "failed" ? "failed" : eligible ? "suggested" : "skipped"} WHERE run_id=${run.id} AND event_id=${event.id}`;
      }
      yield* sql`UPDATE classification_runs SET status=CASE WHEN ${report.status}='failed' THEN 'failed' WHEN EXISTS(SELECT 1 FROM classification_items WHERE run_id=${run.id} AND status='pending') THEN 'running' ELSE 'completed' END,failure=${report.failure} WHERE id=${run.id}`;
      return true;
    }),
  });
});
export const failClassification = Effect.fn("failClassification")(function* (
  input: typeof FailClassification.Type,
) {
  const sql = yield* PgClient.PgClient;
  yield* sql`UPDATE classification_runs SET status='failed',failure=${input.message} WHERE id=${input.runId} AND status IN ('pending','running')`;
});
export const listSuggestions = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;
  return yield* sql`SELECT e.id AS "eventId",p.description,e.suggestion FROM events e JOIN postings p ON p.id=e.primary_posting_id WHERE e.active AND e.suggestion IS NOT NULL ORDER BY p.posted_on DESC,e.id DESC`.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(SuggestionList)),
  );
});
export const acceptSuggestions = Effect.fn("acceptSuggestions")(function* (
  input: typeof AcceptSuggestions.Type,
) {
  const sql = yield* PgClient.PgClient;
  const commands = yield* Commands;
  return yield* commands.run({
    commandId: input.commandId,
    input: { operation: "acceptSuggestions", ...input },
    result: AcceptanceSummary,
    execute: Effect.gen(function* () {
      const protectedIds = yield* protectedEvents;
      let accepted = 0;
      let skipped = 0;
      for (const expected of input.expectedVersions) {
        const [row] =
          yield* sql`SELECT suggestion FROM events WHERE id=${expected.eventId} AND active`.pipe(
            Effect.flatMap(
              Schema.decodeUnknownEffect(
                Schema.Array(Schema.Struct({ suggestion: Schema.NullOr(CategorySuggestion) })),
              ),
            ),
          );
        const suggestion = row?.suggestion;
        const rules =
          yield* sql`SELECT event_id FROM rule_applications WHERE event_id=${expected.eventId}`;
        if (
          !suggestion?.categoryId ||
          suggestion.eventVersion !== expected.version ||
          protectedIds.has(expected.eventId) ||
          rules.length
        ) {
          skipped++;
          continue;
        }
        const event = yield* readEvent(expected.eventId);
        const category =
          yield* sql`SELECT id FROM categories WHERE id=${suggestion.categoryId} AND NOT archived`;
        if (
          event.version !== expected.version ||
          event.allocations.length !== 1 ||
          event.allocations[0].categoryId !== null ||
          !category.length
        ) {
          skipped++;
          continue;
        }
        const updated = {
          ...event,
          version: event.version + 1,
          allocations: [{ ...event.allocations[0], categoryId: suggestion.categoryId }],
        } satisfies typeof import("@repo/contracts/finance").FinancialEvent.Type;
        yield* writeEvent(updated);
        yield* recordCorrection({
          prior: event,
          accepted: updated,
          commandId: input.commandId,
          scope: "event",
        });
        accepted++;
      }
      return { accepted, skipped };
    }),
  });
});

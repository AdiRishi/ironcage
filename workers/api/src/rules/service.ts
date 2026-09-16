import { PgClient } from "@effect/sql-pg";
import {
  DeleteRule,
  FinanceError,
  PreviewRule,
  Rule,
  RuleExceptions,
  RuleInput,
  RulePreview,
  Rules as RuleList,
  SaveRule,
} from "@repo/contracts/finance";
import { Context, Effect, Layer, Schema } from "effect";

import { Commands } from "../database/commands.ts";
import { toFinanceError } from "../database/failures.ts";
import { checkEventVersions } from "../events/correction-records.ts";
import { previewPeriod } from "../events/impact.ts";
import { writeRulePlan } from "./apply.ts";
import { planRules } from "./plan.ts";
import { readRules, ruleExceptions } from "./repository.ts";

export class Rules extends Context.Service<
  Rules,
  {
    readonly list: Effect.Effect<typeof RuleList.Type, FinanceError>;
    readonly exceptions: (
      input: typeof RuleInput.Type,
    ) => Effect.Effect<typeof RuleExceptions.Type, FinanceError>;
    readonly preview: (
      input: typeof PreviewRule.Type,
    ) => Effect.Effect<typeof RulePreview.Type, FinanceError>;
    readonly save: (input: typeof SaveRule.Type) => Effect.Effect<boolean, FinanceError>;
    readonly remove: (input: typeof DeleteRule.Type) => Effect.Effect<boolean, FinanceError>;
  }
>()("@repo/api/Rules") {
  static readonly layer = Layer.effect(
    Rules,
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      const commands = yield* Commands;
      const provide = <A, E>(effect: Effect.Effect<A, E, PgClient.PgClient>) =>
        effect.pipe(Effect.provideService(PgClient.PgClient, sql));
      const validate = Effect.fn(function* (rule: Rule) {
        if (
          !rule.conditions.accountId &&
          !rule.conditions.role &&
          !rule.conditions.merchantId &&
          !rule.conditions.description
        )
          return yield* new FinanceError({
            kind: "invalid",
            message: "Give the rule at least one condition.",
          });
        if (rule.action.kind === "category") {
          const rows =
            yield* sql`SELECT id FROM categories WHERE id=${rule.action.categoryId} AND NOT archived`;
          if (!rows.length)
            return yield* new FinanceError({
              kind: "invalid",
              message: "Choose an active category.",
            });
        }
        if (
          rule.conditions.merchantId &&
          !(yield* sql`SELECT id FROM merchants WHERE id=${rule.conditions.merchantId}`).length
        )
          return yield* new FinanceError({
            kind: "invalid",
            message: "Choose an existing merchant.",
          });
        if (
          rule.conditions.accountId &&
          !(yield* sql`SELECT id FROM accounts WHERE id=${rule.conditions.accountId}`).length
        )
          return yield* new FinanceError({
            kind: "invalid",
            message: "Choose an existing account.",
          });
      });
      const list = readRules.pipe(provide, toFinanceError);
      const exceptions = Effect.fn("Rules.exceptions")(
        ({ ruleId }: typeof RuleInput.Type) =>
          ruleExceptions.pipe(
            Effect.map((rows) =>
              rows.filter((row) => row.ruleId === ruleId).map((row) => row.eventId),
            ),
          ),
        provide,
        toFinanceError,
      );
      const preview = Effect.fn("Rules.preview")(
        (input: typeof PreviewRule.Type) =>
          sql.withTransaction(
            Effect.gen(function* () {
              yield* sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`;
              yield* validate(input.rule);
              const plan = yield* planRules(input);
              const periods = [
                ...new Map(
                  plan.changes.flatMap((change) =>
                    change.prior.postings.map(
                      (posting) =>
                        [
                          `${posting.amount.currency}:${posting.postedOn.slice(0, 7)}`,
                          { currency: posting.amount.currency, on: posting.postedOn },
                        ] as const,
                    ),
                  ),
                ).values(),
              ];
              const impacts = yield* Effect.forEach(periods, (period) => {
                const changes = plan.changes.filter(
                  (change) => change.prior.magnitude.currency === period.currency,
                );
                return previewPeriod(
                  changes.map((change) => change.prior),
                  changes.map((change) => change.accepted),
                  undefined,
                  period.on,
                );
              });
              return {
                ...input,
                matched: plan.considered.length,
                matches: plan.considered.flatMap((event) => {
                  const posting = event.postings.find((row) => row.id === event.primaryPostingId);
                  return posting
                    ? [
                        {
                          eventId: event.id,
                          postingId: posting.id,
                          description: posting.description,
                          postedOn: posting.postedOn,
                        },
                      ]
                    : [];
                }),
                expectedVersions: plan.considered.map((event) => ({
                  eventId: event.id,
                  version: event.version,
                })),
                affected: plan.changes
                  .filter((change) => !plan.conflicts.includes(change.prior.id))
                  .map((change) => change.prior.id),
                exceptions: plan.exceptions,
                conflicts: plan.conflicts,
                impacts,
              };
            }),
          ),
        provide,
        toFinanceError,
      );
      const save = Effect.fn("Rules.save")(
        (input: typeof SaveRule.Type) =>
          commands.run({
            commandId: input.commandId,
            input: { operation: "saveRule", ...input },
            result: Schema.Boolean,
            execute: Effect.gen(function* () {
              yield* validate(input.rule);
              const current = (yield* readRules).find((rule) => rule.id === input.rule.id);
              if ((current?.version ?? null) !== input.expectedVersion)
                return yield* new FinanceError({
                  kind: "stale",
                  message: "This rule changed. Keep your edit and preview the current rule again.",
                });
              const plan = yield* planRules({
                ...input,
                rule: { ...input.rule, version: (input.expectedVersion ?? 0) + 1 },
              });
              yield* checkEventVersions(plan.considered, input.expectedVersions);
              yield* sql`INSERT INTO rules(id,name,conditions,action,scope,version) VALUES (${input.rule.id},${input.rule.name},${sql.json(input.rule.conditions)},${sql.json(input.rule.action)},${input.rule.scope},${(input.expectedVersion ?? 0) + 1}) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,conditions=EXCLUDED.conditions,action=EXCLUDED.action,scope=EXCLUDED.scope,version=EXCLUDED.version`;
              yield* sql`DELETE FROM rule_exceptions WHERE rule_id=${input.rule.id}`;
              const exceptionIds = [...new Set(input.exceptionEventIds)];
              if (exceptionIds.length) {
                const existing =
                  yield* sql`SELECT id FROM events WHERE ${sql.in("id", exceptionIds)}`;
                if (existing.length !== exceptionIds.length)
                  return yield* new FinanceError({
                    kind: "invalid",
                    message: "An excluded event no longer exists.",
                  });
                yield* sql`INSERT INTO rule_exceptions ${sql.insert(exceptionIds.map((eventId) => ({ rule_id: input.rule.id, event_id: eventId })))}`;
              }
              yield* writeRulePlan(plan, input.commandId);
              return true;
            }),
          }),
        provide,
        toFinanceError,
      );
      const remove = Effect.fn("Rules.remove")(
        (input: typeof DeleteRule.Type) =>
          commands.run({
            commandId: input.commandId,
            input: { operation: "deleteRule", ...input },
            result: Schema.Boolean,
            execute: Effect.gen(function* () {
              const rows =
                yield* sql`DELETE FROM rules WHERE id=${input.ruleId} AND version=${input.expectedVersion} RETURNING id`;
              if (!rows.length)
                return yield* new FinanceError({
                  kind: "stale",
                  message: "The rule changed. Refresh it before deleting.",
                });
              return true;
            }),
          }),
        toFinanceError,
      );
      return Rules.of({ list, exceptions, preview, save, remove });
    }),
  );
}

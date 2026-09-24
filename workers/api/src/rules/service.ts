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
import { allocationRole } from "@repo/finance";
import { Array as Arr, Context, Crypto, Effect, Layer, Schema } from "effect";

import { previewImpacts } from "../analysis/preview.ts";
import { Commands } from "../database/commands.ts";
import { toFinanceError } from "../database/failures.ts";
import { readEvents } from "../events/repository.ts";
import { claimRules, reinterpret } from "../interpretation/engine.ts";
import { planRule } from "./plan.ts";
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
      const crypto = yield* Crypto.Crypto;
      const commands = yield* Commands;
      const provide = <A, E>(effect: Effect.Effect<A, E, PgClient.PgClient | Crypto.Crypto>) =>
        effect.pipe(
          Effect.provideService(PgClient.PgClient, sql),
          Effect.provideService(Crypto.Crypto, crypto),
        );
      const validate = Effect.fn(function* (rule: Rule) {
        if (
          !rule.conditions.accountId &&
          !rule.conditions.role &&
          !rule.conditions.counterpartyId &&
          !rule.conditions.channel &&
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
          rule.conditions.counterpartyId &&
          !(yield* sql`SELECT id FROM counterparties WHERE id=${rule.conditions.counterpartyId}`)
            .length
        )
          return yield* new FinanceError({
            kind: "invalid",
            message: "Choose an existing counterparty.",
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
              const plan = yield* planRule(input);
              const prior = yield* readEvents(plan.changes.map((change) => change.eventId));
              const accepted = prior.map((event) => {
                const change = plan.changes.find((row) => row.eventId === event.id);
                return change
                  ? {
                      ...event,
                      kind: change.kind,
                      roleSource: change.roleSource,
                      counterpartyId: change.counterpartyId,
                      counterpartySource: change.counterpartySource,
                      allocations: Arr.map(event.allocations, (allocation) =>
                        allocation.id === change.allocationId
                          ? {
                              ...allocation,
                              role: allocationRole(change.kind),
                              categoryId: change.categoryId,
                              categorySource: change.categorySource,
                            }
                          : allocation,
                      ),
                    }
                  : event;
              });
              const impacts = yield* previewImpacts({ before: prior, after: accepted });
              return {
                ...input,
                matched: plan.matches.length,
                matches: plan.matches.map((subject) => ({
                  eventId: subject.id,
                  postingId: subject.postingId,
                  description: subject.description,
                  postedOn: subject.postedOn,
                })),
                expectedVersions: plan.matches.map((subject) => ({
                  eventId: subject.id,
                  version: subject.version,
                })),
                affected: plan.changes
                  .filter((change) => !plan.conflicts.includes(change.eventId))
                  .map((change) => change.eventId),
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
              const rule = { ...input.rule, version: (input.expectedVersion ?? 0) + 1 };
              const plan = yield* planRule({ ...input, rule });
              if (
                plan.matches.some(
                  (subject) =>
                    !input.expectedVersions.some(
                      (expected) =>
                        expected.eventId === subject.id && expected.version === subject.version,
                    ),
                )
              )
                return yield* new FinanceError({
                  kind: "stale",
                  message: "The matching transactions changed. Preview the rule again.",
                });
              yield* sql`INSERT INTO rules(id,name,conditions,action,scope,version) VALUES (${rule.id},${rule.name},${sql.json(rule.conditions)},${sql.json(rule.action)},${rule.scope},${rule.version}) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,conditions=EXCLUDED.conditions,action=EXCLUDED.action,scope=EXCLUDED.scope,version=EXCLUDED.version`;
              yield* sql`DELETE FROM rule_exceptions WHERE rule_id=${rule.id}`;
              const exceptionIds = [...new Set(input.exceptionEventIds)];
              if (exceptionIds.length) {
                const existing =
                  yield* sql`SELECT id FROM events WHERE ${sql.in("id", exceptionIds)}`;
                if (existing.length !== exceptionIds.length)
                  return yield* new FinanceError({
                    kind: "invalid",
                    message: "An excluded event no longer exists.",
                  });
                yield* sql`INSERT INTO rule_exceptions ${sql.insert(exceptionIds.map((eventId) => ({ rule_id: rule.id, event_id: eventId })))}`;
              }
              if (rule.scope !== "future")
                yield* reinterpret(yield* claimRules({ scope: "all", rules: [rule] }));
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

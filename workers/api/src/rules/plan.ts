import { PgClient } from "@effect/sql-pg";
import {
  EventId,
  MerchantId,
  type FinancialEvent,
  type PreviewRule,
  type Rule,
} from "@repo/contracts/finance";
import { applyRuleAction, correctEvent, ruleActionKey, ruleMatches } from "@repo/finance";
import { Effect, Schema } from "effect";

import { readEvents } from "../events/repository.ts";
import { protectedEvents, readRules, ruleApplications, ruleExceptions } from "./repository.ts";

export const planRules = Effect.fn("planRules")(function* (
  input: typeof PreviewRule.Type | null,
  newEventIds?: readonly (typeof EventId.Type)[],
) {
  const sql = yield* PgClient.PgClient;
  const aliases = yield* sql`SELECT merchant_id AS "merchantId",pattern FROM merchant_aliases`.pipe(
    Effect.flatMap(
      Schema.decodeUnknownEffect(
        Schema.Array(Schema.Struct({ merchantId: MerchantId, pattern: Schema.String })),
      ),
    ),
  );
  const stored = yield* readRules;
  const applications = yield* ruleApplications;
  const existingExceptions = yield* ruleExceptions;
  const excluded = input
    ? [
        ...existingExceptions.filter((row) => row.ruleId !== input.rule.id),
        ...input.exceptionEventIds.map((eventId) => ({ ruleId: input.rule.id, eventId })),
      ]
    : existingExceptions;
  const protectedIds = yield* protectedEvents;
  const ids =
    newEventIds ??
    (yield* sql`SELECT id FROM events WHERE active`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ id: EventId })))),
    )).map((row) => row.id);
  const events = yield* readEvents(ids);
  const changes: {
    prior: FinancialEvent;
    accepted: FinancialEvent;
    base: FinancialEvent;
    rules: readonly Rule[];
  }[] = [];
  const exceptions: { eventId: typeof EventId.Type; reason: string }[] = [];
  const conflicts: (typeof EventId.Type)[] = [];
  const considered: FinancialEvent[] = [];
  for (const event of events) {
    const application = applications.find((row) => row.eventId === event.id);
    const base = application?.prior ?? event;
    const candidateMatches = input
      ? ruleMatches(input.rule, base, aliases) || ruleMatches(input.rule, event, aliases)
      : true;
    const previouslyApplied = input && application?.rules.some((rule) => rule.id === input.rule.id);
    if (!candidateMatches && !previouslyApplied) continue;
    considered.push(event);
    if (protectedIds.has(event.id) || event.allocations.length !== 1) {
      exceptions.push({
        eventId: event.id,
        reason: "Specific correction, split, or accepted relationship",
      });
      continue;
    }
    if (input?.rule.scope === "future" && !newEventIds) continue;
    const matching = newEventIds
      ? stored.filter(
          (rule) =>
            rule.scope !== "past" &&
            ruleMatches(rule, base, aliases) &&
            !excluded.some((row) => row.ruleId === rule.id && row.eventId === event.id),
        )
      : [
          ...(application?.rules ?? []).filter((rule) => rule.id !== input?.rule.id),
          ...(input &&
          ruleMatches(input.rule, base, aliases) &&
          !input.exceptionEventIds.includes(event.id)
            ? [input.rule]
            : []),
        ];
    if (input?.exceptionEventIds.includes(event.id))
      exceptions.push({ eventId: event.id, reason: "Excluded from this rule" });
    const disputed = new Set(matching.map(ruleActionKey)).size > 1;
    if (disputed) conflicts.push(event.id);
    const [first] = matching;
    const accepted =
      first && !disputed
        ? applyRuleAction({ ...base, version: event.version }, first)
        : { ...base, version: event.version + 1 };
    const valid = yield* correctEvent(event, {
      eventId: event.id,
      kind: accepted.kind,
      purchaseOn: accepted.purchaseOn,
      allocations: accepted.allocations,
    }).pipe(Effect.result);
    if (valid._tag === "Failure") {
      exceptions.push({ eventId: event.id, reason: valid.failure.message });
      continue;
    }
    const changed =
      event.kind !== accepted.kind ||
      event.allocations[0].categoryId !== accepted.allocations[0].categoryId;
    if (changed || matching.length > 0 || application)
      changes.push({ prior: event, accepted, base, rules: matching });
  }
  return { changes, exceptions, conflicts, considered };
});

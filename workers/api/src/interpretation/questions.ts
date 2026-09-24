import { PgClient } from "@effect/sql-pg";
import {
  Counterparty,
  EventId,
  FinanceError,
  ListQuestions,
  Question,
  QuestionKind,
  QuestionList,
  QuestionSample,
} from "@repo/contracts/finance";
import { Context, Effect, Layer, Schema } from "effect";

import { instant } from "../database/columns.ts";
import { toFinanceError } from "../database/failures.ts";
import { loadEventSubjects, subjectRuleConflict } from "./engine.ts";

const Group = Schema.Struct({
  key: Schema.String,
  kind: QuestionKind,
  aliasKey: Schema.NullOr(Schema.String),
  reference: Question.fields.reference,
  counterpartyId: Schema.NullOr(Schema.String),
  proposalConfidence: Schema.NullOr(Schema.Finite),
  proposalReason: Schema.NullOr(Schema.String),
  eventCount: Schema.Int,
  outflowMinor: Schema.BigIntFromString,
  inflowMinor: Schema.BigIntFromString,
  samples: Schema.Array(QuestionSample),
});

export class Questions extends Context.Service<
  Questions,
  {
    readonly list: (
      input: typeof ListQuestions.Type,
    ) => Effect.Effect<typeof QuestionList.Type, FinanceError>;
  }
>()("@repo/api/interpretation/Questions") {
  static readonly layer = Layer.effect(
    Questions,
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      const list = Effect.fn("Questions.list")(
        function* ({ currency }: typeof ListQuestions.Type) {
          return yield* sql.withTransaction(
            Effect.gen(function* () {
              yield* sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`;
              // One question per person or proposed counterparty, per proposed alias, per
              // unknown own account, and per alias key of the remaining unresolved events.
              const groups = yield* sql`WITH candidates AS (
                SELECT e.id AS event_id, p.id AS posting_id, p.posted_on, p.description, p.amount_minor, p.currency,
                  d.alias_key, d.own_account_suffix, d.reference_key, d.reference, COALESCE(c.id, pa.counterparty_id) AS counterparty_id,
                  pa.confidence::float8 AS proposal_confidence, pa.reason AS proposal_reason,
                  CASE
                    WHEN c.id IS NULL AND pa.counterparty_id IS NOT NULL THEN 'alias'
                    WHEN c.kind = 'person' AND (c.default_role IS NULL OR c.status = 'proposed') AND cr.counterparty_id IS NULL THEN 'person'
                    WHEN c.status = 'proposed' THEN 'counterparty'
                    WHEN d.own_account_suffix IS NOT NULL AND c.id IS NULL THEN 'ownAccount'
                    ELSE 'unresolved'
                  END AS kind
                FROM events e
                JOIN postings p ON p.id = e.primary_posting_id
                LEFT JOIN posting_descriptors d ON d.posting_id = p.id
                LEFT JOIN counterparties c ON c.id = e.counterparty_id
                LEFT JOIN counterparty_aliases pa ON pa.alias_key = d.alias_key AND pa.status = 'proposed'
                LEFT JOIN counterparty_references cr ON cr.counterparty_id = c.id AND cr.reference_key = d.reference_key
                WHERE e.active AND e.currency = ${currency}
                  AND (e.kind = 'unresolved' OR c.status = 'proposed' OR (c.kind = 'person' AND c.default_role IS NULL AND cr.counterparty_id IS NULL)
                    OR (c.id IS NULL AND pa.alias_key IS NOT NULL))
              ), keyed AS (
                -- A person's payments are asked about per reference, so rent and a bill
                -- split to the same person become separate questions.
                SELECT *, kind || ':' || CASE WHEN kind = 'alias' THEN alias_key
                  WHEN kind = 'person' THEN counterparty_id::text || ':' || COALESCE(reference_key, '')
                  ELSE COALESCE(counterparty_id::text, alias_key, event_id::text) END AS key FROM candidates
              )
              SELECT key, min(kind) AS kind, min(alias_key) AS "aliasKey", min(counterparty_id::text) AS "counterpartyId",
                CASE WHEN min(kind) = 'person' AND min(reference_key) IS NOT NULL
                  THEN jsonb_build_object('key', min(reference_key), 'sample', min(reference)) END AS reference,
                min(proposal_confidence) AS "proposalConfidence", min(proposal_reason) AS "proposalReason",
                count(*)::int AS "eventCount",
                COALESCE(-sum(amount_minor) FILTER (WHERE amount_minor < 0), 0)::text AS "outflowMinor",
                COALESCE(sum(amount_minor) FILTER (WHERE amount_minor > 0), 0)::text AS "inflowMinor",
                (array_agg(jsonb_build_object('eventId', event_id, 'postingId', posting_id, 'postedOn', posted_on::text,
                  'description', description, 'amount', jsonb_build_object('currency', currency, 'minor', amount_minor::text))
                  ORDER BY posted_on DESC, event_id))[1:5] AS samples
              FROM keyed GROUP BY key
              ORDER BY COALESCE(-sum(amount_minor) FILTER (WHERE amount_minor < 0), 0) + COALESCE(sum(amount_minor) FILTER (WHERE amount_minor > 0), 0) DESC, key
              LIMIT 300`.pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Group))));
              const counterpartyIds = groups.flatMap((group) =>
                group.counterpartyId ? [group.counterpartyId] : [],
              );
              const counterparties =
                counterpartyIds.length === 0
                  ? []
                  : yield* sql`SELECT c.id, c.name, c.kind, c.brand, c.default_category_id AS "defaultCategoryId", c.default_role AS "defaultRole", c.source, c.status, c.model, c.confidence::float8 AS confidence, c.reason, c.version, ${instant(sql, sql("c.updated_at"))} AS "updatedAt" FROM counterparties c WHERE ${sql.in("c.id", counterpartyIds)}`.pipe(
                      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Counterparty))),
                    );
              const claimed =
                yield* sql`SELECT r.event_id AS id FROM rule_applications r JOIN events e ON e.id = r.event_id AND e.active AND e.currency = ${currency} WHERE jsonb_array_length(r.applied_rules) > 1`.pipe(
                  Effect.flatMap(
                    Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ id: EventId }))),
                  ),
                );
              const conflicts = (yield* loadEventSubjects(claimed.map((row) => row.id))).filter(
                subjectRuleConflict,
              );
              const money = (minor: bigint) => ({ currency, minor });
              return [
                ...groups.map((group): Question => ({
                  id: group.key,
                  kind: group.kind,
                  aliasKey: group.aliasKey,
                  reference: group.reference,
                  counterparty:
                    counterparties.find((row) => row.id === group.counterpartyId) ?? null,
                  proposal:
                    group.proposalConfidence === null || group.proposalReason === null
                      ? null
                      : { confidence: group.proposalConfidence, reason: group.proposalReason },
                  eventCount: group.eventCount,
                  outflow: money(group.outflowMinor),
                  inflow: money(group.inflowMinor),
                  samples: group.samples,
                })),
                ...conflicts.map((subject): Question => ({
                  id: `ruleConflict:${subject.id}`,
                  kind: "ruleConflict",
                  aliasKey: null,
                  reference: null,
                  counterparty: null,
                  proposal: null,
                  eventCount: 1,
                  outflow: money(subject.amountMinor < 0n ? -subject.amountMinor : 0n),
                  inflow: money(subject.amountMinor > 0n ? subject.amountMinor : 0n),
                  samples: [
                    {
                      eventId: subject.id,
                      postingId: subject.postingId,
                      postedOn: subject.postedOn,
                      description: subject.description,
                      amount: { currency, minor: subject.amountMinor },
                    },
                  ],
                })),
              ];
            }),
          );
        },
        Effect.provideService(PgClient.PgClient, sql),
        toFinanceError,
      );
      return Questions.of({ list });
    }),
  );
}

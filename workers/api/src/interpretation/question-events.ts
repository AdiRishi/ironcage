import { PgClient } from "@effect/sql-pg";
import { EventId, type Period } from "@repo/contracts/finance";
import { rolesWithoutCategory } from "@repo/finance";
import { Effect, Schema, Struct } from "effect";

import { spendingDate } from "../database/columns.ts";
import { loadEventSubjects, subjectConflictingRules } from "./engine.ts";

// Events whose rules disagree about a value they would set, each with those rules.
const ruleConflicts = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;
  const claimed =
    yield* sql`SELECT event_id AS id FROM rule_applications WHERE jsonb_array_length(applied_rules) > 1`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ id: EventId })))),
    );
  const subjects = yield* loadEventSubjects(claimed.map((row) => row.id));
  return subjects.flatMap((subject) => {
    const rules = subjectConflictingRules(subject);
    return rules.length === 0
      ? []
      : [{ eventId: subject.id, rules: rules.map(Struct.pick(["id", "name", "action"])) }];
  });
});

// The one definition of an open question, as the common table `question_events` for a
// query's `WITH`. Every count of questions, the money they affect, and the transactions
// behind them read it, so they agree. It has one row per open question and active event
// behind it: the question's kind and key, the event's primary posting, and whether its
// spending date falls in `period`, or true without one. An event can be behind two
// questions, such as an unresolved transfer whose rules also disagree.
//
// The kinds are tried in order, so a proposed alias asks first which counterparty it is,
// and a person's payment asks per reference until a reference default answers it. Every
// kind but `alias` covers only events an answer can change: an event whose role you or a
// link set, and whose role takes no category or whose category you set or split, is left
// out. An alias answer changes the counterparty itself, so it covers all of its events.
export const questionEventsTable = Effect.fn("questionEventsTable")(function* (
  period: Period | null,
) {
  const sql = yield* PgClient.PgClient;
  const conflicts = yield* ruleConflicts;
  const inPeriod = period
    ? sql`${spendingDate(sql)} >= ${period.start}::date AND ${spendingDate(sql)} < ${period.endExclusive}::date`
    : sql`true`;
  const columns = sql`e.id AS event_id, p.id AS posting_id, e.currency, p.posted_on, p.description,
    p.amount_minor, ${inPeriod} AS in_period`;
  return sql`question_events AS (
    SELECT ${columns}, k.kind, k.kind || ':' || CASE k.kind
        WHEN 'person' THEN c.id::text || ':' || COALESCE(d.reference_key, '')
        WHEN 'counterparty' THEN c.id::text
        WHEN 'unresolved' THEN COALESCE(d.alias_key, e.id::text)
        ELSE d.alias_key END AS key,
      d.alias_key, COALESCE(c.id, pa.counterparty_id) AS counterparty_id, d.reference_key, d.reference,
      NULL::jsonb AS rules
    FROM events e
    JOIN postings p ON p.id = e.primary_posting_id
    LEFT JOIN posting_descriptors d ON d.posting_id = p.id
    LEFT JOIN counterparties c ON c.id = e.counterparty_id
    LEFT JOIN counterparty_aliases pa ON pa.alias_key = d.alias_key AND pa.status = 'proposed'
    LEFT JOIN counterparty_references cr ON cr.counterparty_id = c.id AND cr.reference_key = d.reference_key
    CROSS JOIN LATERAL (SELECT CASE
        WHEN c.id IS NULL AND pa.alias_key IS NOT NULL THEN 'alias'
        WHEN c.kind = 'person' AND cr.counterparty_id IS NULL AND (c.default_role IS NULL OR c.status = 'proposed') THEN 'person'
        WHEN c.kind <> 'person' AND c.status = 'proposed' THEN 'counterparty'
        WHEN e.kind = 'unresolved' AND c.id IS NULL AND d.own_account_suffix IS NOT NULL THEN 'ownAccount'
        WHEN e.kind = 'unresolved' THEN 'unresolved'
      END AS kind) k
    WHERE e.active AND k.kind IS NOT NULL
      AND (k.kind = 'alias' OR (e.role_source IN ('user', 'link') AND (${sql.in("e.kind", rolesWithoutCategory)}
        OR (SELECT count(*) > 1 OR bool_or(al.category_source IS NOT DISTINCT FROM 'user') FROM allocations al WHERE al.event_id = e.id))) IS NOT TRUE)
    UNION ALL
    SELECT ${columns}, 'ruleConflict', 'ruleConflict:' || e.id::text, NULL, NULL, NULL, NULL, x.rules
    FROM jsonb_to_recordset(${sql.json(conflicts)}) AS x("eventId" uuid, rules jsonb)
    JOIN events e ON e.id = x."eventId"
    JOIN postings p ON p.id = e.primary_posting_id
  )`;
});

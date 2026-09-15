import type { PgClient } from "@effect/sql-pg";
import { AccountId, Candidate, ObservationId, PostingId } from "@repo/contracts/finance";
import { MatchingPosting, type MatchAssignment, type MatchingObservation } from "@repo/finance";
import { type Crypto, Effect, Schema } from "effect";

import { money, nullableMoney } from "../database/columns.ts";

export const readMatchingPostings = (sql: PgClient.PgClient, accountId: typeof AccountId.Type) =>
  sql`SELECT p.id, jsonb_build_object('postedOn', p.posted_on::text, 'valueOn', p.value_on::text, 'description', p.description, 'amount', ${money(sql, "p.currency", "p.amount_minor")}, 'originalMoney', ${nullableMoney(sql, "p.original_currency", "p.original_amount_minor")}, 'balance', NULL, 'bankId', NULL) AS candidate,
    (SELECT jsonb_agg(jsonb_build_object('sourceFileId', o.source_file_id, 'locatorKey', o.locator_key, 'order', i.statement->>'order', 'candidate', o.candidate) ORDER BY o.source_file_id, o.locator_key) FROM observations o JOIN imports i ON i.id = o.import_id WHERE o.posting_id = p.id) AS evidence
    FROM postings p WHERE p.account_id = ${accountId} ORDER BY p.posted_on, p.id`.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(MatchingPosting))),
  );

export const applyAssignments = Effect.fn("applyAssignments")(function* (
  sql: PgClient.PgClient,
  crypto: Crypto.Crypto,
  accountId: typeof AccountId.Type,
  observations: ReadonlyArray<MatchingObservation>,
  assignments: ReadonlyArray<MatchAssignment>,
) {
  const byId = new Map(observations.map((row) => [row.id, row]));
  const affected = new Set<typeof PostingId.Type>();
  const created: {
    id: typeof PostingId.Type;
    account_id: typeof AccountId.Type;
    currency: string;
    amount_minor: bigint;
    posted_on: string;
    value_on: string | null;
    description: string;
    original_currency: string | null;
    original_amount_minor: bigint | null;
  }[] = [];
  const links: {
    id: typeof ObservationId.Type;
    postingId: typeof PostingId.Type;
    method: string;
    created: boolean;
    candidate: typeof Candidate.Encoded;
  }[] = [];
  for (const assignment of assignments) {
    const row = byId.get(assignment.observationId)!;
    const candidate = row.candidate;
    const postingId = assignment.postingId ?? PostingId.make(yield* crypto.randomUUIDv4);
    if (assignment.postingId === null)
      created.push({
        id: postingId,
        account_id: accountId,
        currency: candidate.amount.currency,
        amount_minor: candidate.amount.minor,
        posted_on: candidate.postedOn,
        value_on: candidate.valueOn,
        description: candidate.description,
        original_currency: candidate.originalMoney?.currency ?? null,
        original_amount_minor: candidate.originalMoney?.minor ?? null,
      });
    links.push({
      id: row.id,
      postingId,
      method: assignment.method,
      created: assignment.postingId === null,
      candidate: yield* Schema.encodeEffect(Candidate)(candidate),
    });
    affected.add(postingId);
  }
  if (created.length > 0) yield* sql`INSERT INTO postings ${sql.insert(created)}`;
  // A relinked row keeps its original `created` flag so republishing after a review
  // preserves the import's new and matched counts.
  if (links.length > 0)
    yield* sql`UPDATE observations o SET posting_id = x."postingId"::uuid, candidate = x.candidate, match_method = x.method, match_evidence = jsonb_build_object('postedOn', x.candidate->'postedOn', 'amount', x.candidate->'amount', 'bankId', x.candidate->'bankId', 'created', CASE WHEN o.posting_id IS NULL THEN x.created ELSE (o.match_evidence->>'created')::boolean END) FROM jsonb_to_recordset(${sql.json({ rows: links })}::jsonb->'rows') AS x(id text, "postingId" text, method text, created boolean, candidate jsonb) WHERE o.id = x.id::uuid`;
  // The latest accepted review wins across sources, including later reparses.
  // Unreviewed display fields prefer OFX over CSV over PDF wording.
  if (affected.size > 0)
    yield* sql`WITH preferred AS (
    SELECT DISTINCT ON (o.posting_id) o.posting_id, o.candidate
    FROM observations o JOIN imports i ON i.id = o.import_id JOIN source_files s ON s.id = o.source_file_id
    LEFT JOIN LATERAL (
      SELECT max(r.resolved_at) AS decided_at
      FROM review_items r, jsonb_array_elements(r.resolution->'decisions') d
      WHERE o.id = ANY(r.observation_ids) AND d->>'observationId' = o.id::text
        AND d->'decision'->>'kind' IN ('correct', 'keep')
    ) review ON true
    WHERE ${sql.in("o.posting_id", Array.from(affected))}
    ORDER BY o.posting_id, review.decided_at DESC NULLS LAST, CASE i.format WHEN 'ofx' THEN 0 WHEN 'csv' THEN 1 ELSE 2 END, s.sha256, o.locator_key
  ) UPDATE postings p SET posted_on = (x.candidate->>'postedOn')::date, value_on = (x.candidate->>'valueOn')::date, currency = x.candidate->'amount'->>'currency', amount_minor = (x.candidate->'amount'->>'minor')::bigint, description = x.candidate->>'description', original_currency = x.candidate->'originalMoney'->>'currency', original_amount_minor = (x.candidate->'originalMoney'->>'minor')::bigint FROM preferred x WHERE p.id = x.posting_id`;
});

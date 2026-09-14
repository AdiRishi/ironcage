import { PgClient } from "@effect/sql-pg";
import {
  AccountId,
  Candidate,
  ObservationId,
  PostingId,
  SourceFileId,
} from "@repo/contracts/finance";
import type { MatchAssignment } from "@repo/finance";
import { Crypto, Effect, Schema } from "effect";

import { effectiveCandidate, type StoredObservation } from "./observations.ts";

const MatchingPosting = Schema.Struct({
  id: PostingId,
  candidate: Candidate,
  evidence: Schema.Array(
    Schema.Struct({
      sourceFileId: SourceFileId,
      locatorKey: Schema.String,
      order: Schema.Literals(["ascending", "descending"]),
      candidate: Candidate,
    }),
  ),
});
export const readMatchingPostings = Effect.fn("readMatchingPostings")(function* (
  accountId: typeof AccountId.Type,
) {
  const sql = yield* PgClient.PgClient;
  return yield* sql`SELECT p.id, jsonb_build_object('postedOn', p.posted_on::text, 'valueOn', p.value_on::text, 'description', p.description, 'amount', jsonb_build_object('currency', p.currency, 'minor', p.amount_minor::text), 'originalMoney', CASE WHEN p.original_currency IS NULL THEN NULL ELSE jsonb_build_object('currency', p.original_currency, 'minor', p.original_amount_minor::text) END, 'balance', NULL, 'bankId', NULL) AS candidate,
    (SELECT jsonb_agg(jsonb_build_object('sourceFileId', o.source_file_id, 'locatorKey', o.locator_key, 'order', i.statement->>'order', 'candidate', o.candidate) ORDER BY o.source_file_id, o.locator_key) FROM observations o JOIN imports i ON i.id = o.import_id WHERE o.posting_id = p.id) AS evidence
    FROM postings p WHERE p.account_id = ${accountId} ORDER BY p.posted_on, p.id`.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(MatchingPosting))),
  );
});

export const applyAssignments = Effect.fn("applyAssignments")(function* (
  accountId: typeof AccountId.Type,
  observations: ReadonlyArray<StoredObservation>,
  assignments: ReadonlyArray<MatchAssignment>,
) {
  const sql = yield* PgClient.PgClient;
  const crypto = yield* Crypto.Crypto;
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
    const row = byId.get(assignment.observationId);
    const candidate = row && effectiveCandidate(row);
    if (!candidate) continue;
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
  if (links.length > 0)
    yield* sql`UPDATE observations o SET posting_id = x."postingId"::uuid, candidate = x.candidate, match_method = x.method, match_evidence = jsonb_build_object('postedOn', x.candidate->'postedOn', 'amount', x.candidate->'amount', 'bankId', x.candidate->'bankId', 'created', CASE WHEN o.posting_id IS NULL THEN x.created ELSE COALESCE((o.match_evidence->>'created')::boolean, o.match_method = 'new') END) FROM jsonb_to_recordset(${sql.json({ rows: links })}::jsonb->'rows') AS x(id text, "postingId" text, method text, created boolean, candidate jsonb) WHERE o.id = x.id::uuid`;
  if (affected.size > 0)
    yield* sql`WITH preferred AS (
    SELECT DISTINCT ON (o.posting_id) o.posting_id, o.candidate
    FROM observations o JOIN imports i ON i.id = o.import_id JOIN source_files s ON s.id = o.source_file_id
    WHERE ${sql.in("o.posting_id", Array.from(affected))}
    ORDER BY o.posting_id, CASE o.decision->>'kind' WHEN 'correct' THEN 0 WHEN 'keep' THEN 0 ELSE 1 END, CASE i.format WHEN 'ofx' THEN 0 WHEN 'csv' THEN 1 ELSE 2 END, s.sha256, o.locator_key
  ) UPDATE postings p SET posted_on = (x.candidate->>'postedOn')::date, value_on = (x.candidate->>'valueOn')::date, currency = x.candidate->'amount'->>'currency', amount_minor = (x.candidate->'amount'->>'minor')::bigint, description = x.candidate->>'description', original_currency = x.candidate->'originalMoney'->>'currency', original_amount_minor = (x.candidate->'originalMoney'->>'minor')::bigint FROM preferred x WHERE p.id = x.posting_id`;
});

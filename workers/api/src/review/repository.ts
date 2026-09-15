import type { PgClient } from "@effect/sql-pg";
import {
  ImportId,
  ListReviewItems,
  ReviewItemId,
  ObservationId,
  ReviewCandidate,
  PostingId,
  ReviewItem,
  ReviewKind,
  ReviewQuestion,
} from "@repo/contracts/finance";
import { type Crypto, Effect, Schema, Struct } from "effect";

import { instant, postingFields } from "../database/columns.ts";

export interface PendingQuestion {
  readonly kind: typeof ReviewKind.Type;
  readonly question: typeof ReviewQuestion.Type;
  readonly observationIds: ReadonlyArray<typeof ObservationId.Type>;
  readonly postingIds: ReadonlyArray<typeof PostingId.Type>;
}
const StoredReview = Schema.Struct({
  ...Struct.omit(ReviewItem.fields, ["candidates"]),
  postingIds: Schema.Array(PostingId),
});

export const readReviews = Effect.fn("readReviews")(function* (
  sql: PgClient.PgClient,
  input: typeof ListReviewItems.Type & { reviewItemId?: typeof ReviewItemId.Type; limit: number },
) {
  const predicates = [
    input.open === false ? sql`r.resolved_at IS NOT NULL` : sql`r.resolved_at IS NULL`,
  ];
  if (input.importId) predicates.push(sql`r.import_id = ${input.importId}`);
  if (input.reviewItemId) predicates.push(sql`r.id = ${input.reviewItemId}`);
  if (input.cursor)
    predicates.push(
      sql`(r.created_at, r.id) > (${input.cursor.createdAt}::timestamptz, ${input.cursor.id}::uuid)`,
    );
  const items =
    yield* sql`SELECT r.id, r.import_id AS "importId", s.file_name AS "fileName", s.id AS "sourceFileId", s.bytes_available AS "bytesAvailable", r.kind, r.question, r.version, ${instant(sql, sql("r.created_at"))} AS "createdAt", r.candidates AS "postingIds", r.resolution, ${instant(sql, sql("r.resolved_at"))} AS "resolvedAt",
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id', o.id, 'locator', o.locator, 'raw', o.raw, 'candidate', o.parsed_candidate, 'acceptedCandidate', CASE WHEN o.posting_id IS NULL THEN NULL ELSE o.candidate END, 'postingId', o.posting_id) ORDER BY array_position(r.observation_ids, o.id)) FROM observations o WHERE o.id = ANY(r.observation_ids)), '[]'::jsonb) AS observations
    FROM review_items r JOIN imports i ON i.id = r.import_id JOIN source_files s ON s.id = i.source_file_id WHERE ${sql.and(predicates)} ORDER BY r.created_at, r.id LIMIT ${input.limit}`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(StoredReview))),
    );
  const postingIds = [...new Set(items.flatMap((item) => item.postingIds))];
  const candidates =
    postingIds.length === 0
      ? []
      : yield* sql`SELECT ${postingFields(sql)}, COALESCE((SELECT jsonb_agg(jsonb_build_object('sourceFileId', s.id, 'fileName', s.file_name, 'bytesAvailable', s.bytes_available, 'locator', o.locator) ORDER BY s.uploaded_at) FROM observations o JOIN source_files s ON s.id = o.source_file_id WHERE o.posting_id = p.id), '[]'::jsonb) AS sources FROM postings p JOIN accounts a ON a.id = p.account_id WHERE ${sql.in("p.id", postingIds)} ORDER BY p.posted_on, p.id`.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(ReviewCandidate))),
        );
  return items.map(({ postingIds, ...item }): ReviewItem => ({
    ...item,
    candidates: candidates.filter((candidate) => postingIds.includes(candidate.id)),
  }));
});

export const replaceQuestions = Effect.fn("replaceQuestions")(function* (
  sql: PgClient.PgClient,
  crypto: Crypto.Crypto,
  importId: typeof ImportId.Type,
  questions: ReadonlyArray<PendingQuestion>,
) {
  yield* sql`DELETE FROM review_items WHERE import_id = ${importId} AND resolved_at IS NULL`;
  for (const item of questions) {
    const id = yield* crypto.randomUUIDv4;
    yield* sql`INSERT INTO review_items (id, import_id, kind, observation_ids, question, candidates) VALUES (${id}, ${importId}, ${item.kind}, ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(${sql.json({ ids: item.observationIds })}::jsonb->'ids')), ${sql.json(item.question)}, ${sql.json({ ids: item.postingIds })}::jsonb->'ids')`;
  }
});

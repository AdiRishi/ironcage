import { PgClient } from "@effect/sql-pg";
import {
  FinanceError,
  ListPostings,
  Posting,
  PostingDetail,
  PostingInput,
  PostingPage,
} from "@repo/contracts/finance";
import { Context, Effect, Layer, Schema } from "effect";

import { postingFields } from "../database/columns.ts";
import { toFinanceError } from "../database/failures.ts";

const pageSize = 50;
export class Postings extends Context.Service<
  Postings,
  {
    readonly list: (
      input: typeof ListPostings.Type,
    ) => Effect.Effect<typeof PostingPage.Type, FinanceError>;
    readonly get: (
      input: typeof PostingInput.Type,
    ) => Effect.Effect<typeof PostingDetail.Type, FinanceError>;
  }
>()("@repo/api/postings/Postings") {
  static readonly layer = Layer.effect(
    Postings,
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      const fields = postingFields(sql);
      const list = Effect.fn("Postings.list")(function* ({
        filter,
        cursor,
      }: typeof ListPostings.Type) {
        const predicates = [sql`true`];
        if (filter.role)
          predicates.push(
            sql`EXISTS (SELECT 1 FROM events e JOIN event_postings ep ON ep.event_id = e.id WHERE ep.posting_id = p.id AND ep.active AND e.kind = ${filter.role})`,
          );
        if (filter.interpretationReview !== undefined)
          predicates.push(
            sql`EXISTS (SELECT 1 FROM review_items r JOIN event_postings ep ON ep.event_id = ANY(r.event_ids) WHERE ep.posting_id = p.id AND ep.active AND r.resolved_at IS NULL) = ${filter.interpretationReview}`,
          );
        const allocations = [sql`al.event_id = ep.event_id`];
        if (filter.categoryId)
          allocations.push(
            sql`al.category_id IN (WITH RECURSIVE tree AS (SELECT id FROM categories WHERE id = ${filter.categoryId} UNION ALL SELECT c.id FROM categories c JOIN tree ON c.parent_id = tree.id) SELECT id FROM tree)`,
          );
        if (filter.merchantId) allocations.push(sql`al.merchant_id = ${filter.merchantId}`);
        if (filter.tagId)
          allocations.push(
            sql`EXISTS (SELECT 1 FROM allocation_tags at WHERE at.allocation_id = al.id AND at.tag_id = ${filter.tagId})`,
          );
        if (filter.personalEventId)
          allocations.push(
            sql`EXISTS (SELECT 1 FROM allocation_personal_events ap WHERE ap.allocation_id = al.id AND ap.personal_event_id = ${filter.personalEventId})`,
          );
        if (allocations.length > 1)
          predicates.push(
            sql`EXISTS (SELECT 1 FROM event_postings ep JOIN allocations al ON al.event_id = ep.event_id WHERE ep.posting_id = p.id AND ep.active AND ${sql.and(allocations)})`,
          );
        if (filter.accountId) predicates.push(sql`p.account_id = ${filter.accountId}`);
        if (filter.currency) predicates.push(sql`p.currency = ${filter.currency}`);
        if (filter.from) predicates.push(sql`p.posted_on >= ${filter.from}::date`);
        if (filter.to) predicates.push(sql`p.posted_on <= ${filter.to}::date`);
        if (filter.minimum) predicates.push(sql`p.amount_minor >= ${filter.minimum}::bigint`);
        if (filter.maximum) predicates.push(sql`p.amount_minor <= ${filter.maximum}::bigint`);
        if (filter.description)
          predicates.push(
            sql`(strpos(lower(p.description), lower(${filter.description})) > 0 OR EXISTS (SELECT 1 FROM event_postings ep JOIN allocations al ON al.event_id = ep.event_id JOIN merchants m ON m.id = al.merchant_id WHERE ep.posting_id = p.id AND ep.active AND strpos(lower(m.name), lower(${filter.description})) > 0))`,
          );
        if (filter.importId)
          predicates.push(
            sql`EXISTS (SELECT 1 FROM observations o WHERE o.posting_id = p.id AND o.import_id = ${filter.importId})`,
          );
        if (filter.needsReview !== undefined)
          predicates.push(
            sql`EXISTS (SELECT 1 FROM review_items r WHERE r.resolved_at IS NULL AND (r.candidates ? p.id::text OR EXISTS (SELECT 1 FROM observations o WHERE o.id = ANY(r.observation_ids) AND o.posting_id = p.id))) = ${filter.needsReview}`,
          );
        if (cursor)
          predicates.push(
            sql`(p.posted_on, p.id) < (${cursor.postedOn}::date, ${cursor.id}::uuid)`,
          );
        const rows =
          yield* sql`SELECT ${fields} FROM postings p JOIN accounts a ON a.id = p.account_id WHERE ${sql.and(predicates)} ORDER BY p.posted_on DESC, p.id DESC LIMIT ${pageSize + 1}`.pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Posting))),
          );
        const page = rows.slice(0, pageSize);
        const last = page.at(-1);
        return {
          rows: page,
          nextCursor:
            rows.length > pageSize && last ? { postedOn: last.postedOn, id: last.id } : null,
        };
      }, toFinanceError);
      const get = Effect.fn("Postings.get")(function* ({ postingId }: typeof PostingInput.Type) {
        return yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`;
            const [posting] =
              yield* sql`SELECT ${fields} FROM postings p JOIN accounts a ON a.id = p.account_id WHERE p.id = ${postingId}`.pipe(
                Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Posting))),
              );
            if (!posting)
              return yield* new FinanceError({
                kind: "notFound",
                message: "Transaction not found.",
              });
            const evidence =
              yield* sql`SELECT o.id, s.id AS "sourceFileId", s.file_name AS "fileName", s.bytes_available AS "bytesAvailable", o.locator, o.raw, o.candidate, o.match_method AS "matchMethod" FROM observations o JOIN source_files s ON s.id = o.source_file_id WHERE o.posting_id = ${postingId} ORDER BY s.uploaded_at, o.locator_key`.pipe(
                Effect.flatMap(Schema.decodeUnknownEffect(PostingDetail.fields.evidence)),
              );
            return { posting, evidence };
          }),
        );
      }, toFinanceError);
      return Postings.of({ list, get });
    }),
  );
}

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
        if (filter.accountId) predicates.push(sql`p.account_id = ${filter.accountId}`);
        if (filter.currency) predicates.push(sql`p.currency = ${filter.currency}`);
        if (filter.from) predicates.push(sql`p.posted_on >= ${filter.from}::date`);
        if (filter.to) predicates.push(sql`p.posted_on <= ${filter.to}::date`);
        if (filter.minimum) predicates.push(sql`p.amount_minor >= ${filter.minimum}::bigint`);
        if (filter.maximum) predicates.push(sql`p.amount_minor <= ${filter.maximum}::bigint`);
        if (filter.description)
          predicates.push(sql`strpos(lower(p.description), lower(${filter.description})) > 0`);
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

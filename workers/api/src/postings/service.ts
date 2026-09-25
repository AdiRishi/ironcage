import { PgClient } from "@effect/sql-pg";
import {
  CalendarDate,
  FinanceError,
  LedgerPage,
  LedgerRow,
  ListPostings,
  PostingId,
  Posting,
  PostingDetail,
  PostingInput,
  PostingPage,
} from "@repo/contracts/finance";
import { Context, Effect, Layer, Schema } from "effect";

import { postingFields } from "../database/columns.ts";
import { toFinanceError } from "../database/failures.ts";
import { readTransaction } from "../database/transactions.ts";

const pageSize = 50;
export class Postings extends Context.Service<
  Postings,
  {
    readonly list: (
      input: typeof ListPostings.Type,
    ) => Effect.Effect<typeof PostingPage.Type, FinanceError>;
    readonly ledger: (
      input: typeof ListPostings.Type,
    ) => Effect.Effect<typeof LedgerPage.Type, FinanceError>;
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
      const predicatesFor = ({ filter, cursor }: typeof ListPostings.Type) => {
        const predicates = [sql`true`];
        if (filter.role)
          predicates.push(
            sql`EXISTS (SELECT 1 FROM events e JOIN event_postings ep ON ep.event_id = e.id WHERE ep.posting_id = p.id AND ep.active AND e.kind = ${filter.role})`,
          );
        if (filter.interpretationReview !== undefined)
          predicates.push(
            sql`EXISTS (SELECT 1 FROM event_postings ep JOIN events e ON e.id = ep.event_id LEFT JOIN counterparties c ON c.id = e.counterparty_id WHERE ep.posting_id = p.id AND ep.active AND (e.kind = 'unresolved' OR c.status = 'proposed' OR (c.kind = 'person' AND c.default_role IS NULL))) = ${filter.interpretationReview}`,
          );
        if (filter.counterpartyId)
          predicates.push(
            sql`EXISTS (SELECT 1 FROM event_postings ep JOIN events e ON e.id = ep.event_id WHERE ep.posting_id = p.id AND ep.active AND e.counterparty_id = ${filter.counterpartyId})`,
          );
        const allocations = [sql`al.event_id = ep.event_id`];
        if (filter.categoryId)
          allocations.push(
            sql`al.category_id IN (WITH RECURSIVE tree AS (SELECT id FROM categories WHERE id = ${filter.categoryId} UNION ALL SELECT c.id FROM categories c JOIN tree ON c.parent_id = tree.id) SELECT id FROM tree)`,
          );
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
            sql`(strpos(lower(p.description), lower(${filter.description})) > 0 OR EXISTS (SELECT 1 FROM event_postings ep JOIN events e ON e.id = ep.event_id JOIN counterparties c ON c.id = e.counterparty_id WHERE ep.posting_id = p.id AND ep.active AND strpos(lower(c.name), lower(${filter.description})) > 0))`,
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
        return predicates;
      };
      const page = <A extends { postedOn: string; id: string }>(rows: readonly A[]) => {
        const shown = rows.slice(0, pageSize);
        const last = shown.at(-1);
        return {
          rows: shown,
          nextCursor:
            rows.length > pageSize && last
              ? { postedOn: CalendarDate.make(last.postedOn), id: PostingId.make(last.id) }
              : null,
        };
      };
      const list = Effect.fn("Postings.list")(function* (input: typeof ListPostings.Type) {
        const rows =
          yield* sql`SELECT ${fields} FROM postings p JOIN accounts a ON a.id = p.account_id WHERE ${sql.and(predicatesFor(input))} ORDER BY p.posted_on DESC, p.id DESC LIMIT ${pageSize + 1}`.pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Posting))),
          );
        return page(rows);
      }, toFinanceError);
      const ledger = Effect.fn("Postings.ledger")(function* (input: typeof ListPostings.Type) {
        const rows =
          yield* sql`SELECT ${fields}, x."eventId", x.role, x."counterpartyId", x."counterpartyName", x."categoryId",
              x."categoryName", x."categorySlug", COALESCE(x.split, false) AS split,
              CASE
                WHEN x."eventId" IS NULL THEN 'none'
                WHEN x.split OR x."roleSource" = 'user' OR x."categorySource" = 'user' THEN 'you'
                WHEN x."roleSource" = 'rule' OR x."categorySource" = 'rule' THEN 'rule'
                WHEN (x."roleSource" = 'counterparty' OR x."categorySource" = 'counterparty') AND x."counterpartySource" = 'model' THEN 'model'
                WHEN x."roleSource" = 'counterparty' OR x."categorySource" = 'counterparty' THEN 'you'
                WHEN x."roleSource" = 'bank' THEN 'bank'
                ELSE 'none'
              END AS "assignedBy",
              COALESCE(x.question, false) AS question
            FROM postings p JOIN accounts a ON a.id = p.account_id
            LEFT JOIN LATERAL (
              SELECT e.id AS "eventId", e.kind AS role, e.role_source AS "roleSource", c.id AS "counterpartyId",
                c.name AS "counterpartyName", c.source AS "counterpartySource", al.category_id AS "categoryId",
                k.name AS "categoryName", COALESCE(k.slug, parent.slug) AS "categorySlug", al.category_source AS "categorySource",
                (SELECT count(*) FROM allocations x WHERE x.event_id = e.id) > 1 AS split,
                (e.kind = 'unresolved' OR c.status = 'proposed' OR (c.kind = 'person' AND c.default_role IS NULL)) AS question
              FROM event_postings ep JOIN events e ON e.id = ep.event_id AND e.active
              LEFT JOIN counterparties c ON c.id = e.counterparty_id
              LEFT JOIN LATERAL (SELECT * FROM allocations WHERE event_id = e.id ORDER BY id LIMIT 1) al ON true
              LEFT JOIN categories k ON k.id = al.category_id
              LEFT JOIN categories parent ON parent.id = k.parent_id
              WHERE ep.posting_id = p.id AND ep.active LIMIT 1
            ) x ON true
            WHERE ${sql.and(predicatesFor(input))} ORDER BY p.posted_on DESC, p.id DESC LIMIT ${pageSize + 1}`.pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(LedgerRow))),
          );
        return page(rows);
      }, toFinanceError);
      const get = Effect.fn("Postings.get")(function* ({ postingId }: typeof PostingInput.Type) {
        return yield* readTransaction(
          sql,
          Effect.gen(function* () {
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
      return Postings.of({ list, ledger, get });
    }),
  );
}

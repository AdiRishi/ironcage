import { PgClient } from "@effect/sql-pg";
import {
  AllocationRole,
  CalendarDate,
  CountedLedgerPage,
  FinanceError,
  LedgerPage,
  LedgerRow,
  ListCountedLedger,
  ListPostings,
  PostingId,
  Posting,
  PostingDetail,
  PostingInput,
  PostingPage,
} from "@repo/contracts/finance";
import { categoryTreeForRole } from "@repo/finance";
import { Context, Effect, Layer, Schema } from "effect";

import { categorySubtree } from "../analysis/fact-sql.ts";
import { postingFields } from "../database/columns.ts";
import { toFinanceError } from "../database/failures.ts";
import { readTransaction } from "../database/transactions.ts";
import { countedLedger } from "./counted.ts";
import {
  allocationPredicates,
  ledgerMeaning,
  ledgerRowColumns,
  pageSize,
  postingPredicates,
} from "./ledger-rows.ts";

// Allocations in these roles belong in a category, so without one they are not yet
// categorised.
const categorisedRoles = AllocationRole.literals.filter(
  (role) => categoryTreeForRole(role) !== null,
);

export class Postings extends Context.Service<
  Postings,
  {
    readonly list: (
      input: typeof ListPostings.Type,
    ) => Effect.Effect<typeof PostingPage.Type, FinanceError>;
    readonly ledger: (
      input: typeof ListPostings.Type,
    ) => Effect.Effect<typeof LedgerPage.Type, FinanceError>;
    readonly counted: (
      input: typeof ListCountedLedger.Type,
    ) => Effect.Effect<typeof CountedLedgerPage.Type, FinanceError>;
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
        const predicates = postingPredicates(sql, filter);
        if (filter.counterpartyId)
          predicates.push(
            sql`EXISTS (SELECT 1 FROM event_postings ep JOIN events e ON e.id = ep.event_id WHERE ep.posting_id = p.id AND ep.active AND e.counterparty_id = ${filter.counterpartyId})`,
          );
        const allocations = allocationPredicates(sql, sql`al.id`, filter);
        if (filter.categoryId === "uncategorised")
          allocations.push(sql`al.category_id IS NULL AND ${sql.in("al.role", categorisedRoles)}`);
        else if (filter.categoryId)
          allocations.push(sql`al.category_id IN (${categorySubtree(sql, filter.categoryId)})`);
        if (allocations.length > 0)
          predicates.push(
            sql`EXISTS (SELECT 1 FROM event_postings ep JOIN allocations al ON al.event_id = ep.event_id WHERE ep.posting_id = p.id AND ep.active AND ${sql.and(allocations)})`,
          );
        if (filter.currency) predicates.push(sql`p.currency = ${filter.currency}`);
        if (filter.from) predicates.push(sql`p.posted_on >= ${filter.from}::date`);
        if (filter.to) predicates.push(sql`p.posted_on <= ${filter.to}::date`);
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
          yield* sql`SELECT ${ledgerRowColumns(sql)} FROM postings p JOIN accounts a ON a.id = p.account_id ${ledgerMeaning(sql)}
            WHERE ${sql.and(predicatesFor(input))} ORDER BY p.posted_on DESC, p.id DESC LIMIT ${pageSize + 1}`.pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(LedgerRow))),
          );
        return page(rows);
      }, toFinanceError);
      const counted = Effect.fn("Postings.counted")(
        (input: typeof ListCountedLedger.Type) => readTransaction(sql, countedLedger(input)),
        Effect.provideService(PgClient.PgClient, sql),
        toFinanceError,
      );
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
            // The event's primary posting names its counterparty, whichever of its
            // postings this is.
            const [descriptor] =
              yield* sql`SELECT d.alias_key AS "aliasKey", d.counterparty_text AS "counterpartyText",
                  (SELECT count(*) FROM events ce JOIN posting_descriptors cd ON cd.posting_id = ce.primary_posting_id
                    WHERE ce.active AND cd.alias_key = d.alias_key
                      AND (ce.counterparty_source IS DISTINCT FROM 'user' OR ce.id = e.id))::int AS "eventCount",
                  (SELECT a.version FROM counterparty_aliases a WHERE a.alias_key = d.alias_key) AS "aliasVersion"
                FROM event_postings ep JOIN events e ON e.id = ep.event_id
                JOIN posting_descriptors d ON d.posting_id = e.primary_posting_id
                WHERE ep.posting_id = ${postingId} AND ep.active AND d.alias_key IS NOT NULL`.pipe(
                Effect.flatMap(
                  Schema.decodeUnknownEffect(Schema.Array(PostingDetail.fields.descriptor)),
                ),
              );
            return { posting, evidence, descriptor: descriptor ?? null };
          }),
        );
      }, toFinanceError);
      return Postings.of({ list, ledger, counted, get });
    }),
  );
}

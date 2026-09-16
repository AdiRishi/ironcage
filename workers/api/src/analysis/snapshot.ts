import { PgClient } from "@effect/sql-pg";
import {
  Account,
  AccountId,
  CalendarDate,
  EventId,
  Instant,
  Posting,
  ReferenceData,
  type OverviewInput,
  FinanceError,
} from "@repo/contracts/finance";
import { Effect, Schema } from "effect";

import { accountFields, instant, postingFields } from "../database/columns.ts";
import { readEvents } from "../events/repository.ts";
import { readCredits } from "../relationships/repository.ts";

const CoverageSource = Schema.Struct({
  accountId: AccountId,
  observedStart: Schema.NullOr(CalendarDate),
  observedEnd: Schema.NullOr(CalendarDate),
  openingOn: Schema.NullOr(CalendarDate),
  closingOn: Schema.NullOr(CalendarDate),
  reconciled: Schema.Boolean,
});
export const readAnalysisSnapshot = Effect.fn("readAnalysisSnapshot")(function* (
  input: OverviewInput,
) {
  const sql = yield* PgClient.PgClient;
  const accounts =
    yield* sql`SELECT ${accountFields(sql)} FROM accounts WHERE currency=${input.currency} AND ${input.accounts.length ? sql.in("id", input.accounts) : sql`true`} ORDER BY label,id`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Account))),
    );
  if (input.accounts.some((id) => !accounts.some((account) => account.id === id)))
    return yield* new FinanceError({
      kind: "invalid",
      message: "Choose accounts in the selected currency.",
    });
  const ids = accounts.map((account) => account.id);
  const eventIds =
    yield* sql`SELECT id FROM events WHERE active AND currency=${input.currency}`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ id: EventId })))),
    );
  const events = yield* readEvents(eventIds.map((row) => row.id));
  const credits = yield* readCredits();
  const postings =
    yield* sql`SELECT ${postingFields(sql)} FROM postings p JOIN accounts a ON a.id=p.account_id WHERE ${sql.in("p.account_id", ids)}`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Posting))),
    );
  const sources =
    yield* sql`SELECT account_id AS "accountId", observed_start::text AS "observedStart", observed_end::text AS "observedEnd", opening_on::text AS "openingOn", closing_on::text AS "closingOn", (reconciled AND opening_minor IS NOT NULL AND closing_minor IS NOT NULL) AS reconciled FROM source_coverage WHERE ${sql.in("account_id", ids)}`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(CoverageSource))),
    );
  const imports =
    yield* sql`SELECT account_id AS "accountId", ${instant(sql, sql`max(created_at)`)} AS at FROM imports WHERE status IN ('complete','needs_review') AND ${sql.in("account_id", ids)} GROUP BY account_id`.pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(
          Schema.Array(Schema.Struct({ accountId: AccountId, at: Instant })),
        ),
      ),
    );
  const categories =
    yield* sql`SELECT id,parent_id AS "parentId",name,archived,version FROM categories ORDER BY id`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(ReferenceData.fields.categories)),
    );
  const merchants =
    yield* sql`SELECT id,name,version,ARRAY(SELECT pattern FROM merchant_aliases WHERE merchant_id=m.id) AS aliases FROM merchants m`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(ReferenceData.fields.merchants)),
    );
  const tags = yield* sql`SELECT id,name,version FROM tags`.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(ReferenceData.fields.tags)),
  );
  const personalEvents =
    yield* sql`SELECT id,name,start_on::text AS "startOn",end_on::text AS "endOn",exclude_from_ordinary AS "excludeFromOrdinary",version FROM personal_events`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(ReferenceData.fields.personalEvents)),
    );
  return {
    accounts,
    events,
    credits,
    postings,
    sources,
    imports,
    references: { categories, merchants, tags, personalEvents },
  };
});

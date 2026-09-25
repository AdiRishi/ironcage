import { PgClient } from "@effect/sql-pg";
import { Account, AccountId, CalendarDate, Instant } from "@repo/contracts/finance";
import type { CoverageSnapshot } from "@repo/finance";
import { Effect, Schema } from "effect";

import { accountFields, instant } from "../database/columns.ts";

const Coverage = Schema.Struct({
  accountId: AccountId,
  observedStart: Schema.NullOr(CalendarDate),
  observedEnd: Schema.NullOr(CalendarDate),
  openingOn: Schema.NullOr(CalendarDate),
  closingOn: Schema.NullOr(CalendarDate),
  reconciled: Schema.Boolean,
});

export const coverageSources = Effect.fn("coverageSources")(function* (currency: string) {
  const sql = yield* PgClient.PgClient;
  const accounts =
    yield* sql`SELECT ${accountFields(sql)} FROM accounts WHERE currency = ${currency} ORDER BY label, id`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Account))),
    );
  const sources =
    yield* sql`SELECT account_id AS "accountId", observed_start::text AS "observedStart", observed_end::text AS "observedEnd",
        opening_on::text AS "openingOn", closing_on::text AS "closingOn",
        (reconciled AND opening_minor IS NOT NULL AND closing_minor IS NOT NULL) AS reconciled
      FROM source_coverage c JOIN accounts a ON a.id = c.account_id WHERE a.currency = ${currency}`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Coverage))),
    );
  const imports =
    yield* sql`SELECT account_id AS "accountId", ${instant(sql, sql`max(created_at)`)} AS at FROM imports
      WHERE status IN ('complete', 'needs_review') AND account_id IS NOT NULL GROUP BY account_id`.pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(
          Schema.Array(Schema.Struct({ accountId: AccountId, at: Instant })),
        ),
      ),
    );
  return { accounts, sources, imports } satisfies CoverageSnapshot;
});

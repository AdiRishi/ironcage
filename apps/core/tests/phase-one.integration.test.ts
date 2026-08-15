import { expect, it } from "@effect/vitest";
import { Aud, CalendarDate, RequestId, Sha256 } from "@ironcage/domain";
import { BigDecimal, Effect, Schema } from "effect";

import { mintId } from "../src/ids";
import {
  getWholeWealth,
  listExternalAccounts,
  recordExternalBalance,
} from "../src/money/wealth/service";
import { Postgres } from "../src/persistence/postgres";
import {
  getReport,
  generateMonthlySpendingReports,
  listReports,
  markReportOpened,
} from "../src/reports/service";
import { haltAll, getSystemStatus } from "../src/system/service";
import { usePostgresTestDatabase } from "./persistence/postgres-test-database";

const database = usePostgresTestDatabase();
const decodeAud = Schema.decodeUnknownSync(Aud);
const decodeDate = Schema.decodeUnknownSync(CalendarDate);
const decodeHash = Schema.decodeUnknownSync(Sha256);

const withDatabase = <A, E>(effect: Effect.Effect<A, E, Postgres>) =>
  effect.pipe(Effect.provide(Postgres.layerForRequest(database.connectionString())));

const request = (digit: string) => ({
  requestId: mintId(RequestId),
  payloadHash: decodeHash(digit.repeat(64)),
});

it.effect("records external assets and liabilities as one observed net worth", () =>
  Effect.gen(function* () {
    const empty = yield* withDatabase(getWholeWealth());
    expect(empty.netWorth._tag).toBe("Unknown");

    const assetRequest = request("1");
    const asset = yield* withDatabase(
      recordExternalBalance({
        requestId: yield* assetRequest.requestId,
        payloadHash: assetRequest.payloadHash,
        accountId: null,
        label: "Primary residence",
        kind: "asset",
        balance: decodeAud("500000"),
        balanceDate: decodeDate("2032-02-29"),
      }),
    );
    const liabilityRequest = request("2");
    yield* withDatabase(
      recordExternalBalance({
        requestId: yield* liabilityRequest.requestId,
        payloadHash: liabilityRequest.payloadHash,
        accountId: null,
        label: "Mortgage",
        kind: "liability",
        balance: decodeAud("-20000"),
        balanceDate: decodeDate("2032-02-29"),
      }),
    );

    const correctionRequest = request("3");
    const corrected = yield* withDatabase(
      recordExternalBalance({
        requestId: yield* correctionRequest.requestId,
        payloadHash: correctionRequest.payloadHash,
        accountId: asset.id,
        label: asset.label,
        kind: asset.kind,
        balance: decodeAud("510000"),
        balanceDate: decodeDate("2032-03-01"),
      }),
    );

    if (corrected.latestBalance === null) throw new Error("expected the corrected balance");
    expect(BigDecimal.format(corrected.latestBalance)).toBe("510000");
    expect(yield* withDatabase(listExternalAccounts())).toHaveLength(2);

    const wealth = yield* withDatabase(getWholeWealth());
    expect(wealth.positions).toHaveLength(2);
    expect(wealth.netWorth._tag).toBe("Fresh");
    if (wealth.netWorth._tag !== "Fresh") throw new Error("expected fresh net worth");
    expect(BigDecimal.format(wealth.netWorth.value)).toBe("490000");

    const postgres = yield* Postgres;
    const history = yield* postgres.rows(
      "count external balance history",
      Schema.Struct({ count: Schema.Int }),
      "SELECT count(*)::integer AS count FROM external_balance_observations WHERE account_id = $1",
      [asset.id],
    );
    expect(history).toEqual([{ count: 2 }]);
  }).pipe(Effect.provide(Postgres.layerForRequest(database.connectionString()))),
);

it.effect("halts once and exposes the resulting critical state", () =>
  Effect.gen(function* () {
    expect((yield* withDatabase(getSystemStatus())).mode).toBe("running");

    const firstRequest = request("4");
    const halted = yield* withDatabase(
      haltAll({
        requestId: yield* firstRequest.requestId,
        payloadHash: firstRequest.payloadHash,
        reason: "operator safety stop",
      }),
    );
    expect(halted).toMatchObject({
      mode: "halted",
      reason: "operator safety stop",
      unacknowledgedCriticals: 1,
    });

    const secondRequest = request("5");
    const repeated = yield* withDatabase(
      haltAll({
        requestId: yield* secondRequest.requestId,
        payloadHash: secondRequest.payloadHash,
        reason: "a later duplicate stop",
      }),
    );
    expect(repeated.reason).toBe("operator safety stop");
    expect(repeated.unacknowledgedCriticals).toBe(1);

    const postgres = yield* Postgres;
    const events = yield* postgres.rows(
      "count halt events",
      Schema.Struct({ count: Schema.Int }),
      "SELECT count(*)::integer AS count FROM feed_events WHERE event_type = 'system_halted'",
    );
    expect(events).toEqual([{ count: 1 }]);
  }).pipe(Effect.provide(Postgres.layerForRequest(database.connectionString()))),
);

it.effect("persists one immutable report for each complete month", () =>
  Effect.gen(function* () {
    const postgres = yield* Postgres;
    yield* postgres.transaction((sql) =>
      sql.execute(
        "seed complete month",
        `WITH account AS (
           INSERT INTO bank_accounts
             (id, bank, product_label, account_type, currency, required, created_at)
           VALUES ('01910000-0000-7000-8000-000000000001', 'commbank',
                   'Spending offset', 'deposit', 'AUD', true, now())
           RETURNING id
         ), imported AS (
           INSERT INTO bank_imports
             (id, account_id, source_profile, bundle_digest, window_start, window_end,
              status, effects, confirmed_at)
           SELECT '01910000-0000-7000-8000-000000000002', id,
                  'cba-netbank-paired-v1', repeat('a', 64),
                  '2032-01-01', '2032-01-31', 'confirmed',
                  '{"new":1,"duplicate":0,"ambiguous":0}'::jsonb, now()
             FROM account
           RETURNING id, account_id
         ), covered AS (
           INSERT INTO bank_coverage_segments
             (id, account_id, start_date, end_date, source_profile, import_id, status)
           SELECT '01910000-0000-7000-8000-000000000003', account_id,
                  '2032-01-01', '2032-01-31',
                  'cba-netbank-paired-v1', id, 'complete'
             FROM imported
         ), transaction_row AS (
           INSERT INTO bank_transactions
             (id, account_id, posted_date, amount, currency, display_narrative, derived_payee,
              narrative_fingerprint, normalizer_version, created_by_import, created_at)
           SELECT '01910000-0000-7000-8000-000000000004', account_id,
                  '2032-01-10', -125.50, 'AUD',
                  'MARKET', 'MARKET', 'market', 1, id, now()
             FROM imported
           RETURNING id
         )
         INSERT INTO transaction_splits
           (id, transaction_id, revision, category_id, amount, provenance, created_at)
         SELECT '01910000-0000-7000-8000-000000000005', id, 1,
                '01900000-0000-7000-8000-000000000002',
                -125.50, 'manual', now()
           FROM transaction_row`,
      ),
    );

    expect(yield* postgres.transaction(generateMonthlySpendingReports)).toBe(1);
    expect(yield* postgres.transaction(generateMonthlySpendingReports)).toBe(0);

    const reports = yield* withDatabase(listReports());
    expect(reports).toHaveLength(1);
    const summary = reports[0];
    if (summary === undefined) throw new Error("expected a generated report");
    expect(summary).toMatchObject({
      type: "monthly_spending",
      periodStart: "2032-01-01",
      periodEnd: "2032-01-31",
      openedAt: null,
    });

    const report = yield* withDatabase(getReport(summary.id));
    expect(report.month.month).toBe("2032-01");
    expect(BigDecimal.format(report.month.netSpend)).toBe("125.5");

    const openRequest = request("6");
    const opened = yield* withDatabase(
      markReportOpened({
        requestId: yield* openRequest.requestId,
        payloadHash: openRequest.payloadHash,
        reportId: summary.id,
      }),
    );
    expect(opened.openedAt).not.toBeNull();

    const eventRows = yield* postgres.rows(
      "count report generated events",
      Schema.Struct({ count: Schema.Int }),
      "SELECT count(*)::integer AS count FROM feed_events WHERE event_type = 'report_generated'",
    );
    expect(eventRows).toEqual([{ count: 1 }]);
  }).pipe(Effect.provide(Postgres.layerForRequest(database.connectionString()))),
);

it.effect("rejects an external balance whose sign contradicts its kind", () =>
  Effect.gen(function* () {
    const invalidRequest = request("7");
    const error = yield* Effect.flip(
      withDatabase(
        recordExternalBalance({
          requestId: yield* invalidRequest.requestId,
          payloadHash: invalidRequest.payloadHash,
          accountId: null,
          label: "Impossible asset",
          kind: "asset",
          balance: decodeAud("-1"),
          balanceDate: decodeDate("2032-01-01"),
        }),
      ),
    );
    expect(error).toMatchObject({ _tag: "ValidationFailed", reason: "InvalidExternalBalance" });
  }),
);

import {
  ExternalAccount,
  type Observed,
  type WealthPosition,
  ValidationFailed,
} from "@ironcage/contracts/schema";
import {
  Aud,
  BankAccountId,
  CalendarDate,
  ExternalAccountId,
  ExternalBalanceId,
  FeedEventId,
  type RequestId,
  type Sha256,
  WealthKind,
} from "@ironcage/domain";
import { BigDecimal, DateTime, Effect, Schema } from "effect";

import { mintId } from "../../ids";
import { runIdempotentMutation } from "../../persistence/app-requests";
import { persistenceToBoundary } from "../../persistence/error";
import { Postgres, type SqlExecutor } from "../../persistence/postgres";
import { insertFeedEvent } from "../feed/outbox";

const BalancePositionRow = Schema.Struct({
  id: Schema.Union([BankAccountId, ExternalAccountId]),
  source: Schema.Literals(["money", "external"]),
  label: Schema.String,
  kind: WealthKind,
  balance: Schema.NullOr(Schema.BigDecimalFromString),
  balanceDate: Schema.NullOr(CalendarDate),
  observedAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
  createdAt: Schema.DateTimeUtcFromDate,
});

const ExternalAccountRow = Schema.Struct({
  id: ExternalAccountId,
  label: Schema.String,
  kind: WealthKind,
  archived: Schema.Boolean,
  latestBalance: Schema.NullOr(Schema.BigDecimalFromString),
  balanceDate: Schema.NullOr(CalendarDate),
  observedAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
});

const freshnessBudget = { days: 35 } as const;
const decodeAud = Schema.decodeUnknownSync(Aud);

const toObserved = (
  row: typeof BalancePositionRow.Type,
  now: DateTime.Utc,
): Observed<typeof Aud.Type> => {
  if (row.balance === null || row.observedAt === null) {
    return {
      _tag: "Unknown",
      since: row.createdAt,
      reason: "no balance has been recorded",
    };
  }

  const value = decodeAud(BigDecimal.format(row.balance));
  const staleAfter = DateTime.add(row.observedAt, freshnessBudget);
  return DateTime.isGreaterThan(now, staleAfter)
    ? { _tag: "Stale", value, asOf: row.observedAt }
    : { _tag: "Fresh", value, asOf: row.observedAt, staleAfter };
};

const sumObserved = (
  positions: readonly WealthPosition[],
  now: DateTime.Utc,
): Observed<typeof Aud.Type> => {
  const unknown = positions.find((position) => position.balance._tag === "Unknown");
  if (unknown?.balance._tag === "Unknown") {
    return {
      _tag: "Unknown",
      since: unknown.balance.since,
      reason: `${unknown.label}: ${unknown.balance.reason}`,
    };
  }

  const known = positions.flatMap((position) =>
    position.balance._tag === "Unknown" ? [] : [position.balance],
  );
  const total = decodeAud(
    BigDecimal.format(
      known.reduce(
        (sum, observed) => BigDecimal.sum(sum, observed.value),
        BigDecimal.fromBigInt(0n),
      ),
    ),
  );
  if (known.length === 0) {
    return { _tag: "Unknown", since: now, reason: "no wealth balances have been recorded" };
  }

  const asOf = known.map((observed) => observed.asOf).reduce(DateTime.min);
  if (known.some((observed) => observed._tag === "Stale")) {
    return { _tag: "Stale", value: total, asOf };
  }
  const fresh = known.filter(
    (observed): observed is Extract<(typeof known)[number], { readonly _tag: "Fresh" }> =>
      observed._tag === "Fresh",
  );
  const staleAfter = fresh.map((observed) => observed.staleAfter).reduce(DateTime.min);
  return { _tag: "Fresh", value: total, asOf, staleAfter };
};

const loadPositions = (sql: SqlExecutor) =>
  Effect.gen(function* () {
    return yield* sql.rows(
      "load whole wealth positions",
      BalancePositionRow,
      `SELECT a.id, 'money' AS source, a.product_label AS label,
              CASE WHEN a.account_type = 'deposit' THEN 'asset' ELSE 'liability' END AS kind,
              latest.value::text AS balance, latest.as_of_date AS "balanceDate",
              latest.observed_at AS "observedAt", a.created_at AS "createdAt"
         FROM bank_accounts a
         LEFT JOIN LATERAL (
           SELECT b.value, b.as_of_date,
                  COALESCE(b.as_of_time, i.confirmed_at) AS observed_at
             FROM bank_balance_observations b
             LEFT JOIN bank_observations o ON o.id = b.observation_id
             JOIN bank_source_files f ON f.id = COALESCE(b.source_file_id, o.source_file_id)
             JOIN bank_imports i ON i.id = f.import_id
            WHERE b.account_id = a.id
            ORDER BY b.as_of_date DESC, observed_at DESC, b.id DESC
            LIMIT 1
         ) latest ON true
        UNION ALL
       SELECT a.id, 'external' AS source, a.label, a.kind,
              latest.balance::text, latest.balance_date, latest.observed_at, a.created_at
         FROM external_accounts a
         LEFT JOIN LATERAL (
           SELECT b.balance, b.balance_date, b.observed_at
             FROM external_balance_observations b
            WHERE b.account_id = a.id
            ORDER BY b.observed_at DESC, b.id DESC
            LIMIT 1
         ) latest ON true
        WHERE NOT a.archived
        ORDER BY source, label`,
    );
  });

const loadExternalAccounts = (sql: SqlExecutor) =>
  Effect.gen(function* () {
    return yield* sql.rows(
      "list external accounts",
      ExternalAccountRow,
      `SELECT a.id, a.label, a.kind, a.archived,
              latest.balance::text AS "latestBalance", latest.balance_date AS "balanceDate",
              latest.observed_at AS "observedAt"
         FROM external_accounts a
         LEFT JOIN LATERAL (
           SELECT b.balance, b.balance_date, b.observed_at
             FROM external_balance_observations b
            WHERE b.account_id = a.id
            ORDER BY b.observed_at DESC, b.id DESC
            LIMIT 1
         ) latest ON true
        ORDER BY a.archived, a.label`,
    );
  });

const toExternalAccount = (row: typeof ExternalAccountRow.Type): typeof ExternalAccount.Type => ({
  ...row,
  latestBalance:
    row.latestBalance === null ? null : decodeAud(BigDecimal.format(row.latestBalance)),
});

export const getWholeWealth = Effect.fn("getWholeWealth")(function* () {
  const postgres = yield* Postgres;
  const rows = yield* postgres.readTransaction(loadPositions);
  const now = yield* DateTime.now;
  const positions = rows.map((row): WealthPosition => ({
    id: row.id,
    source: row.source,
    label: row.label,
    kind: row.kind,
    balanceDate: row.balanceDate,
    balance: toObserved(row, now),
  }));
  return { positions, netWorth: sumObserved(positions, now) };
}, persistenceToBoundary);

export const listExternalAccounts = Effect.fn("listExternalAccounts")(function* () {
  const postgres = yield* Postgres;
  return (yield* postgres.readTransaction(loadExternalAccounts)).map(toExternalAccount);
}, persistenceToBoundary);

export const recordExternalBalance = Effect.fn("recordExternalBalance")(function* (input: {
  readonly requestId: RequestId;
  readonly payloadHash: Sha256;
  readonly accountId: ExternalAccountId | null;
  readonly label: string;
  readonly kind: typeof WealthKind.Type;
  readonly balance: typeof Aud.Type;
  readonly balanceDate: CalendarDate;
}) {
  const label = input.label.trim();
  if (label.length === 0) {
    return yield* Effect.fail(
      new ValidationFailed({ reason: "InvalidExternalAccount", detail: "label is required" }),
    );
  }
  if (
    (input.kind === "asset" && BigDecimal.isNegative(input.balance)) ||
    (input.kind === "liability" && BigDecimal.isPositive(input.balance))
  ) {
    return yield* Effect.fail(
      new ValidationFailed({
        reason: "InvalidExternalBalance",
        detail: "assets are positive and liabilities are negative",
      }),
    );
  }

  return yield* runIdempotentMutation(
    {
      requestId: input.requestId,
      operation: "recordExternalBalance",
      payloadHash: input.payloadHash,
      response: ExternalAccount,
    },
    (sql) =>
      Effect.gen(function* () {
        const accountId = input.accountId ?? (yield* mintId(ExternalAccountId));
        const accountRows = yield* sql.rows(
          input.accountId === null ? "create external account" : "update external account",
          Schema.Struct({ id: ExternalAccountId }),
          input.accountId === null
            ? `INSERT INTO external_accounts (id, label, kind, currency, created_at)
                 VALUES ($1, $2, $3, 'AUD', now()) RETURNING id`
            : `UPDATE external_accounts SET label = $2, kind = $3 WHERE id = $1 RETURNING id`,
          [accountId, label, input.kind],
        );
        if (accountRows.length === 0) {
          return yield* Effect.fail(
            new ValidationFailed({
              reason: "UnknownExternalAccount",
              detail: `external account ${accountId} does not exist`,
            }),
          );
        }

        yield* sql.execute(
          "record external balance",
          `INSERT INTO external_balance_observations
               (id, account_id, balance, balance_date, observed_at)
             VALUES ($1, $2, $3, $4, now())`,
          [
            yield* mintId(ExternalBalanceId),
            accountId,
            BigDecimal.format(input.balance),
            input.balanceDate,
          ],
        );
        yield* insertFeedEvent(sql, {
          id: yield* mintId(FeedEventId),
          origin: "portfolio",
          category: "money_tax",
          eventType: "external_balance_recorded",
          severity: "info",
          summary: `${label}: external balance recorded`,
          payload: { accountId, balanceDate: input.balanceDate },
          links: null,
        });

        const row = (yield* loadExternalAccounts(sql)).find((account) => account.id === accountId);
        if (row === undefined) {
          return yield* Effect.die(new Error("inserted external account was not readable"));
        }
        return toExternalAccount(row);
      }),
  );
});

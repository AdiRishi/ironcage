import { PgClient } from "@effect/sql-pg";
import {
  Account,
  AccountPeriods,
  DeleteAccountPeriod,
  FinanceError,
  SaveAccountPeriod,
} from "@repo/contracts/finance";
import { Context, Effect, Layer, Schema } from "effect";

import { accountFields } from "../database/columns.ts";
import { Commands } from "../database/commands.ts";
import { toFinanceError } from "../database/failures.ts";
export class AccountHistory extends Context.Service<
  AccountHistory,
  {
    readonly list: Effect.Effect<typeof AccountPeriods.Type, FinanceError>;
    readonly save: (input: typeof SaveAccountPeriod.Type) => Effect.Effect<boolean, FinanceError>;
    readonly remove: (
      input: typeof DeleteAccountPeriod.Type,
    ) => Effect.Effect<boolean, FinanceError>;
  }
>()("@repo/api/AccountHistory") {
  static readonly layer = Layer.effect(
    AccountHistory,
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      const commands = yield* Commands;
      const list =
        sql`SELECT 'label' AS kind,id,account_id AS "accountId",start_on::text AS "startOn",end_on::text AS "endOn",version,label,NULL AS "loanAccountId" FROM account_periods UNION ALL SELECT 'offset',id,deposit_account_id,start_on::text,end_on::text,version,NULL,loan_account_id FROM offset_relationships ORDER BY "startOn",id`.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(AccountPeriods)),
          toFinanceError,
        );
      const save = Effect.fn("AccountHistory.save")(
        (input: typeof SaveAccountPeriod.Type) =>
          commands.run({
            commandId: input.commandId,
            input: { operation: "saveAccountPeriod", ...input },
            result: Schema.Boolean,
            execute: Effect.gen(function* () {
              const { record, expectedVersion } = input;
              if (record.endOn && record.endOn <= record.startOn)
                return yield* new FinanceError({
                  kind: "invalid",
                  message: "End date must be after the start date. The end date is excluded.",
                });
              const table = record.kind === "label" ? "account_periods" : "offset_relationships";
              const column = record.kind === "label" ? "account_id" : "deposit_account_id";
              const current =
                yield* sql`SELECT version FROM ${sql(table)} WHERE id=${record.id}`.pipe(
                  Effect.flatMap(
                    Schema.decodeUnknownEffect(
                      Schema.Array(Schema.Struct({ version: Schema.Int })),
                    ),
                  ),
                );
              if ((current[0]?.version ?? null) !== expectedVersion)
                return yield* new FinanceError({
                  kind: "stale",
                  message: "This account period changed. Refresh it before saving.",
                });
              const ids =
                record.kind === "offset"
                  ? [record.accountId, record.loanAccountId]
                  : [record.accountId];
              const accounts =
                yield* sql`SELECT ${accountFields(sql)} FROM accounts WHERE ${sql.in("id", ids)}`.pipe(
                  Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Account))),
                );
              if (accounts.length !== ids.length)
                return yield* new FinanceError({
                  kind: "invalid",
                  message: "Choose existing, separate accounts.",
                });
              if (record.kind === "offset") {
                const deposit = accounts.find((account) => account.id === record.accountId);
                const loan = accounts.find((account) => account.id === record.loanAccountId);
                if (
                  deposit?.kind !== "deposit" ||
                  loan?.kind !== "loan" ||
                  deposit.currency !== loan.currency
                )
                  return yield* new FinanceError({
                    kind: "conflict",
                    message:
                      "An offset needs a deposit account and a loan account in the same currency.",
                  });
              }
              const overlap =
                yield* sql`SELECT id FROM ${sql(table)} WHERE ${sql(column)}=${record.accountId} AND id<>${record.id} AND daterange(start_on,end_on,'[)') && daterange(${record.startOn}::date,${record.endOn}::date,'[)')`;
              if (overlap.length)
                return yield* new FinanceError({
                  kind: "conflict",
                  message:
                    "This period overlaps an existing period for the account. End or edit that period first.",
                });
              if (record.kind === "label")
                yield* sql`INSERT INTO account_periods(id,account_id,start_on,end_on,label,version) VALUES (${record.id},${record.accountId},${record.startOn},${record.endOn},${record.label},${(expectedVersion ?? 0) + 1}) ON CONFLICT(id) DO UPDATE SET account_id=EXCLUDED.account_id,start_on=EXCLUDED.start_on,end_on=EXCLUDED.end_on,label=EXCLUDED.label,version=EXCLUDED.version`;
              else
                yield* sql`INSERT INTO offset_relationships(id,deposit_account_id,loan_account_id,start_on,end_on,version) VALUES (${record.id},${record.accountId},${record.loanAccountId},${record.startOn},${record.endOn},${(expectedVersion ?? 0) + 1}) ON CONFLICT(id) DO UPDATE SET deposit_account_id=EXCLUDED.deposit_account_id,loan_account_id=EXCLUDED.loan_account_id,start_on=EXCLUDED.start_on,end_on=EXCLUDED.end_on,version=EXCLUDED.version`;
              return true;
            }),
          }),
        toFinanceError,
      );
      const remove = Effect.fn("AccountHistory.remove")(
        (input: typeof DeleteAccountPeriod.Type) =>
          commands.run({
            commandId: input.commandId,
            input: { operation: "deleteAccountPeriod", ...input },
            result: Schema.Boolean,
            execute: Effect.gen(function* () {
              const rows =
                yield* sql`DELETE FROM ${sql(input.kind === "label" ? "account_periods" : "offset_relationships")} WHERE id=${input.id} AND version=${input.expectedVersion} RETURNING id`;
              if (!rows.length)
                return yield* new FinanceError({
                  kind: "stale",
                  message: "This account period changed. Refresh it before deleting.",
                });
              return true;
            }),
          }),
        toFinanceError,
      );
      return AccountHistory.of({ list, save, remove });
    }),
  );
}

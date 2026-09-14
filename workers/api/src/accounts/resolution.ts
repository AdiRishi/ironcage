import { PgClient } from "@effect/sql-pg";
import { Account, AccountId, BankAccount, FinanceError } from "@repo/contracts/finance";
import { Context, Crypto, Effect, Layer, Schema } from "effect";

import { databaseUnavailable } from "../database/commands.ts";

export class AccountResolution extends Context.Service<
  AccountResolution,
  {
    readonly resolve: (input: {
      accountId: typeof AccountId.Type | null;
      identity: typeof BankAccount.Type | null;
    }) => Effect.Effect<Account, FinanceError>;
  }
>()("@repo/api/accounts/AccountResolution") {
  static readonly layer = Layer.effect(
    AccountResolution,
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      const crypto = yield* Crypto.Crypto;
      const fields = sql`id, kind, label, currency, bank_id AS "bankId", account_number AS "accountNumber", version`;
      const decode = Schema.decodeUnknownEffect(Schema.Array(Account));
      const resolve = Effect.fn("AccountResolution.resolve")(
        function* ({
          accountId,
          identity,
        }: Parameters<AccountResolution["Service"]["resolve"]>[0]) {
          if (identity) {
            const existing =
              yield* sql`SELECT ${fields} FROM accounts WHERE bank_id IS NOT DISTINCT FROM ${identity.bankId} AND account_number = ${identity.accountNumber}`.pipe(
                Effect.flatMap(decode),
              );
            const known = existing[0];
            if (known) {
              if (
                known.currency !== identity.currency ||
                known.kind !== identity.kind ||
                (accountId && accountId !== known.id)
              )
                return yield* new FinanceError({
                  kind: "conflict",
                  message: "The bank identity does not agree with the selected account.",
                });
              return known;
            }
          }
          if (accountId) {
            const accounts =
              yield* sql`SELECT ${fields} FROM accounts WHERE id = ${accountId}`.pipe(
                Effect.flatMap(decode),
              );
            const account = accounts[0];
            if (!account)
              return yield* new FinanceError({ kind: "notFound", message: "Account not found." });
            if (!identity) return account;
            if (
              account.accountNumber ||
              account.kind !== identity.kind ||
              account.currency !== identity.currency
            )
              return yield* new FinanceError({
                kind: "conflict",
                message:
                  "Choose an account with the same kind and currency and no other bank identity.",
              });
            const updated =
              yield* sql`UPDATE accounts SET bank_id = ${identity.bankId}, account_number = ${identity.accountNumber}, version = version + 1, updated_at = now() WHERE id = ${accountId} RETURNING ${fields}`.pipe(
                Effect.flatMap(decode),
              );
            return yield* Schema.decodeUnknownEffect(Account)(updated[0]);
          }
          if (!identity)
            return yield* new FinanceError({
              kind: "needsReview",
              message: "Choose the account this file belongs to.",
            });
          const id = yield* crypto.randomUUIDv4;
          const label = `CommBank ${identity.kind} ${identity.accountNumber.slice(-4)}`;
          const accounts =
            yield* sql`INSERT INTO accounts ${sql.insert({ id, label, kind: identity.kind, currency: identity.currency, bank_id: identity.bankId, account_number: identity.accountNumber })} RETURNING ${fields}`.pipe(
              Effect.flatMap(decode),
            );
          return yield* Schema.decodeUnknownEffect(Account)(accounts[0]);
        },
        Effect.catchTags({
          SqlError: () => Effect.fail(databaseUnavailable()),
          SchemaError: () => Effect.fail(databaseUnavailable()),
          PlatformError: () => Effect.fail(databaseUnavailable()),
        }),
      );
      return AccountResolution.of({ resolve });
    }),
  );
}

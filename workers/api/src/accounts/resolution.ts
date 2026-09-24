import { PgClient } from "@effect/sql-pg";
import {
  Account,
  AccountId,
  BankAccount,
  FinanceError,
  institutionNames,
} from "@repo/contracts/finance";
import { Context, Crypto, Effect, Layer, Schema } from "effect";

import { accountFields } from "../database/columns.ts";
import { toFinanceError } from "../database/failures.ts";

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
      const fields = accountFields(sql);
      const decode = Schema.decodeUnknownEffect(Schema.Array(Account));
      const decodeOne = Schema.decodeUnknownEffect(Schema.Tuple([Account]));
      const resolve = Effect.fn("AccountResolution.resolve")(function* ({
        accountId,
        identity,
      }: Parameters<AccountResolution["Service"]["resolve"]>[0]) {
        if (identity) {
          const existing =
            yield* sql`SELECT ${fields} FROM accounts WHERE institution = ${identity.institution} AND account_number = ${identity.accountNumber} AND (bank_id IS NOT DISTINCT FROM ${identity.bankId} OR (kind = ${identity.kind} AND (bank_id IS NULL OR ${identity.bankId}::text IS NULL)))`.pipe(
              Effect.flatMap(decode),
            );
          const selected = existing.find((account) => account.id === accountId);
          if (existing.length > 1 && !selected)
            return yield* new FinanceError({
              kind: "conflict",
              message:
                "The statement omits a bank identifier and more than one account has this account number.",
            });
          const known = selected ?? existing[0];
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
            if (known.bankId === null && identity.bankId !== null) {
              const [identified] =
                yield* sql`UPDATE accounts SET bank_id = ${identity.bankId}, version = version + 1, updated_at = now() WHERE id = ${known.id} RETURNING ${fields}`.pipe(
                  Effect.flatMap(decodeOne),
                );
              return identified;
            }
            return known;
          }
        }
        if (accountId) {
          const [account] = yield* sql`SELECT ${fields} FROM accounts WHERE id = ${accountId}`.pipe(
            Effect.flatMap(decode),
          );
          if (!account)
            return yield* new FinanceError({ kind: "notFound", message: "Account not found." });
          if (!identity) return account;
          if (
            account.accountNumber ||
            account.institution !== identity.institution ||
            account.kind !== identity.kind ||
            account.currency !== identity.currency
          )
            return yield* new FinanceError({
              kind: "conflict",
              message:
                "Choose an account with the same kind and currency and no other bank identity.",
            });
          const [updated] =
            yield* sql`UPDATE accounts SET bank_id = ${identity.bankId}, account_number = ${identity.accountNumber}, version = version + 1, updated_at = now() WHERE id = ${accountId} RETURNING ${fields}`.pipe(
              Effect.flatMap(decodeOne),
            );
          return updated;
        }
        if (!identity)
          return yield* new FinanceError({
            kind: "needsReview",
            message: "Choose the account this file belongs to.",
          });
        const id = yield* crypto.randomUUIDv4;
        const label = `${institutionNames[identity.institution]} ${identity.kind} ${identity.accountNumber.slice(-4)}`;
        const [created] =
          yield* sql`INSERT INTO accounts ${sql.insert({ id, label, kind: identity.kind, institution: identity.institution, currency: identity.currency, bank_id: identity.bankId, account_number: identity.accountNumber })} RETURNING ${fields}`.pipe(
            Effect.flatMap(decodeOne),
          );
        return created;
      }, toFinanceError);
      return AccountResolution.of({ resolve });
    }),
  );
}

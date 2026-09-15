import { PgClient } from "@effect/sql-pg";
import { Account, CreateAccount, UpdateAccount, FinanceError } from "@repo/contracts/finance";
import { Context, Crypto, Effect, Layer, Schema } from "effect";

import { Commands, databaseUnavailable } from "../database/commands.ts";

export class Accounts extends Context.Service<
  Accounts,
  {
    readonly list: Effect.Effect<ReadonlyArray<Account>, FinanceError>;
    readonly create: (input: typeof CreateAccount.Type) => Effect.Effect<Account, FinanceError>;
    readonly update: (input: typeof UpdateAccount.Type) => Effect.Effect<Account, FinanceError>;
  }
>()("@repo/api/accounts/Accounts") {
  static readonly layer = Layer.effect(
    Accounts,
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      const commands = yield* Commands;
      const crypto = yield* Crypto.Crypto;
      const select = sql`id, kind, label, currency, bank_id AS "bankId", account_number AS "accountNumber", version`;
      const decode = Schema.decodeUnknownEffect(Schema.Array(Account));
      const list = sql`SELECT ${select} FROM accounts ORDER BY label, id`.pipe(
        Effect.flatMap(decode),
        Effect.mapError(databaseUnavailable),
        Effect.withSpan("Accounts.list"),
      );
      const create = Effect.fn("Accounts.create")(function* (input: typeof CreateAccount.Type) {
        const id = yield* crypto.randomUUIDv4.pipe(Effect.mapError(databaseUnavailable));
        return yield* commands.run({
          commandId: input.commandId,
          input: { operation: "createAccount", ...input },
          result: Schema.toCodecJson(Account),
          execute: Effect.gen(function* () {
            const rows =
              yield* sql`INSERT INTO accounts (id, label, kind, currency) VALUES (${id}, ${input.label.trim()}, ${input.kind}, ${input.currency}) RETURNING ${select}`.pipe(
                Effect.flatMap(decode),
              );
            return yield* Schema.decodeUnknownEffect(Account)(rows[0]);
          }),
        });
      });
      const update = Effect.fn("Accounts.update")(function* (input: typeof UpdateAccount.Type) {
        return yield* commands.run({
          commandId: input.commandId,
          input: { operation: "updateAccount", ...input },
          result: Schema.toCodecJson(Account),
          execute: Effect.gen(function* () {
            const accounts =
              yield* sql`SELECT ${select} FROM accounts WHERE id = ${input.accountId}`.pipe(
                Effect.flatMap(decode),
              );
            const account = accounts[0];
            if (!account)
              return yield* new FinanceError({ kind: "notFound", message: "Account not found." });
            if (account.version !== input.expectedVersion)
              return yield* new FinanceError({
                kind: "stale",
                message: "The account changed. Refresh it before saving.",
              });
            if (account.accountNumber && account.kind !== input.kind)
              return yield* new FinanceError({
                kind: "conflict",
                message: "The bank has established this account's kind.",
              });
            const rows =
              yield* sql`UPDATE accounts SET label = ${input.label.trim()}, kind = ${input.kind}, version = version + 1, updated_at = now() WHERE id = ${input.accountId} RETURNING ${select}`.pipe(
                Effect.flatMap(decode),
              );
            return yield* Schema.decodeUnknownEffect(Account)(rows[0]);
          }),
        });
      });
      return Accounts.of({ list, create, update });
    }),
  );
}

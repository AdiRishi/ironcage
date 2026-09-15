import { PgClient } from "@effect/sql-pg";
import { Account, CreateAccount, UpdateAccount, FinanceError } from "@repo/contracts/finance";
import { Context, Crypto, Effect, Layer, Schema } from "effect";

import { accountFields } from "../database/columns.ts";
import { Commands } from "../database/commands.ts";
import { toFinanceError } from "../database/failures.ts";

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
      const fields = accountFields(sql);
      const decode = Schema.decodeUnknownEffect(Schema.Array(Account));
      const decodeOne = Schema.decodeUnknownEffect(Schema.Tuple([Account]));
      const list = sql`SELECT ${fields} FROM accounts ORDER BY label, id`.pipe(
        Effect.flatMap(decode),
        toFinanceError,
        Effect.withSpan("Accounts.list"),
      );
      const create = Effect.fn("Accounts.create")(function* (input: typeof CreateAccount.Type) {
        const id = yield* crypto.randomUUIDv4;
        return yield* commands.run({
          commandId: input.commandId,
          input: { operation: "createAccount", ...input },
          result: Schema.toCodecJson(Account),
          execute: Effect.gen(function* () {
            const [account] =
              yield* sql`INSERT INTO accounts (id, label, kind, currency) VALUES (${id}, ${input.label}, ${input.kind}, ${input.currency}) RETURNING ${fields}`.pipe(
                Effect.flatMap(decodeOne),
              );
            return account;
          }),
        });
      }, toFinanceError);
      const update = Effect.fn("Accounts.update")(function* (input: typeof UpdateAccount.Type) {
        return yield* commands.run({
          commandId: input.commandId,
          input: { operation: "updateAccount", ...input },
          result: Schema.toCodecJson(Account),
          execute: Effect.gen(function* () {
            const [account] =
              yield* sql`SELECT ${fields} FROM accounts WHERE id = ${input.accountId}`.pipe(
                Effect.flatMap(decode),
              );
            if (!account)
              return yield* new FinanceError({ kind: "notFound", message: "Account not found." });
            if (account.version !== input.expectedVersion)
              return yield* new FinanceError({
                kind: "stale",
                message: "The account changed. Refresh it before saving.",
              });
            if (account.kind !== input.kind)
              return yield* new FinanceError({
                kind: "conflict",
                message:
                  "An account's kind cannot change. Create a separate account for a different kind.",
              });
            const [updated] =
              yield* sql`UPDATE accounts SET label = ${input.label}, kind = ${input.kind}, version = version + 1, updated_at = now() WHERE id = ${input.accountId} RETURNING ${fields}`.pipe(
                Effect.flatMap(decodeOne),
              );
            return updated;
          }),
        });
      }, toFinanceError);
      return Accounts.of({ list, create, update });
    }),
  );
}

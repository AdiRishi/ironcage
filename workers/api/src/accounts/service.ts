import { Account, FinanceError } from "@repo/contracts/finance";
import { Context, Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql";

export class Accounts extends Context.Service<
  Accounts,
  {
    readonly list: () => Effect.Effect<ReadonlyArray<Account>, FinanceError>;
  }
>()("@repo/api/accounts/Accounts") {
  static readonly layer = Layer.effect(
    Accounts,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const list = Effect.fn("Accounts.list")(function* () {
        return yield* sql`SELECT id, kind, label, currency, bank_id AS "bankId", account_number AS "accountNumber", version FROM accounts ORDER BY label, id`.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Account))),
          Effect.mapError(
            () =>
              new FinanceError({ kind: "unavailable", message: "Accounts could not be loaded." }),
          ),
        );
      });
      return Accounts.of({ list });
    }),
  );
}

import { PgClient } from "@effect/sql-pg";
import { FinanceError, CommandId } from "@repo/contracts/finance";
import { Context, Crypto, Effect, Encoding, Layer, Schema } from "effect";
import type { SqlError } from "effect/unstable/sql";

interface Command<A, R> {
  readonly commandId: typeof CommandId.Type;
  readonly input: Schema.Json;
  readonly result: Schema.Codec<A, Schema.Json>;
  readonly execute: Effect.Effect<A, FinanceError | SqlError.SqlError | Schema.SchemaError, R>;
}
const Receipt = Schema.Struct({ inputHash: Schema.String, result: Schema.Json });
const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Json));

export const fingerprint = Effect.fn("fingerprint")(function* (value: Schema.Json) {
  const crypto = yield* Crypto.Crypto;
  return Encoding.encodeHex(
    yield* crypto.digest("SHA-256", new TextEncoder().encode(yield* encodeJson(value))),
  );
});

export const databaseUnavailable = () =>
  new FinanceError({
    kind: "unavailable",
    message: "The records service is unavailable. Retry the same request.",
  });

export class Commands extends Context.Service<
  Commands,
  {
    readonly run: <A, R>(command: Command<A, R>) => Effect.Effect<A, FinanceError, R>;
  }
>()("@repo/api/database/Commands") {
  static readonly layer = Layer.effect(
    Commands,
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      const crypto = yield* Crypto.Crypto;
      const run = Effect.fn("Commands.run")(
        function* <A, R>(command: Command<A, R>) {
          const hash = yield* fingerprint(command.input).pipe(
            Effect.provideService(Crypto.Crypto, crypto),
          );
          return yield* sql.withTransaction(
            Effect.gen(function* () {
              yield* sql`SELECT pg_advisory_xact_lock(1)`;
              const receipts =
                yield* sql`SELECT input_hash AS "inputHash", result FROM command_receipts WHERE command_id = ${command.commandId}`.pipe(
                  Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Receipt))),
                );
              const receipt = receipts[0];
              if (receipt) {
                if (receipt.inputHash !== hash)
                  return yield* new FinanceError({
                    kind: "conflict",
                    message: "This command ID was already used for another request.",
                  });
                return yield* Schema.decodeEffect(command.result)(receipt.result);
              }
              const result = yield* command.execute;
              const encoded = yield* Schema.encodeEffect(command.result)(result);
              yield* sql`INSERT INTO command_receipts (command_id, input_hash, result) VALUES (${command.commandId}, ${hash}, ${sql.json(encoded)})`;
              return result;
            }),
          );
        },
        Effect.catchTags({
          SqlError: databaseUnavailableEffect,
          SchemaError: databaseUnavailableEffect,
          PlatformError: databaseUnavailableEffect,
        }),
      );
      return Commands.of({ run });
    }),
  );
}

const databaseUnavailableEffect = () => Effect.fail(databaseUnavailable());

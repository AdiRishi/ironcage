import { PgClient } from "@effect/sql-pg";
import { FinanceError, Settings as SettingsValue, UpdateSettings } from "@repo/contracts/finance";
import { Context, Effect, Layer, Schema } from "effect";

import { Commands, databaseUnavailable } from "../database/commands.ts";

export class Settings extends Context.Service<
  Settings,
  {
    readonly get: () => Effect.Effect<SettingsValue, FinanceError>;
    readonly update: (
      input: typeof UpdateSettings.Type,
    ) => Effect.Effect<SettingsValue, FinanceError>;
  }
>()("@repo/api/settings/Settings") {
  static readonly layer = Layer.effect(
    Settings,
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      const commands = yield* Commands;
      const get = Effect.fn("Settings.get")(function* () {
        const rows =
          yield* sql`SELECT timezone, reporting_currency AS "reportingCurrency", version FROM settings WHERE id = 1`;
        return yield* Schema.decodeUnknownEffect(SettingsValue)(rows[0]);
      }, Effect.mapError(databaseUnavailable));
      const update = Effect.fn("Settings.update")(function* (input: typeof UpdateSettings.Type) {
        return yield* commands.run({
          commandId: input.commandId,
          input: { operation: "updateSettings", ...input },
          result: Schema.toCodecJson(SettingsValue),
          execute: Effect.gen(function* () {
            const current = yield* get();
            if (current.version !== input.expectedVersion)
              return yield* new FinanceError({
                kind: "stale",
                message: "Settings changed. Refresh before saving.",
              });
            yield* sql`UPDATE settings SET timezone = ${input.timezone}, reporting_currency = ${input.reportingCurrency}, version = version + 1 WHERE id = 1`;
            return yield* get();
          }),
        });
      });
      return Settings.of({ get, update });
    }),
  );
}

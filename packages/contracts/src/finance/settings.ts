import { Schema } from "effect";

import { CommandId, Currency, Version } from "./values.ts";

export const Timezone = Schema.String.check(
  Schema.makeFilter((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return "Choose a valid IANA timezone.";
    }
  }),
);
export const Settings = Schema.Struct({
  timezone: Timezone,
  reportingCurrency: Currency,
  version: Version,
});
export type Settings = typeof Settings.Type;
export const UpdateSettings = Schema.Struct({
  commandId: CommandId,
  expectedVersion: Version,
  timezone: Timezone,
  reportingCurrency: Currency,
});

export const Retention = Schema.Struct({ database: Schema.String, originals: Schema.String });

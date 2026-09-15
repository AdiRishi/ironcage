import { CommandId } from "@repo/contracts/finance";
import { Crypto, Effect } from "effect";
import { expect } from "vitest";

import { Settings } from "../../src/settings/service.ts";
import { applicationTest } from "../support/application.ts";
import { reset } from "../support/fixtures.ts";

const { test, services } = applicationTest();
test(
  "display settings preserve the first command result and reject stale edits",
  Effect.gen(function* () {
    yield* reset;
    const settings = yield* Settings;
    const original = yield* settings.get;
    const input = {
      commandId: CommandId.make(yield* Crypto.Crypto.use((crypto) => crypto.randomUUIDv4)),
      expectedVersion: original.version,
      timezone: "UTC",
      reportingCurrency: "USD",
    };
    const saved = yield* settings.update(input);
    expect(saved.timezone).toBe("UTC");
    expect(saved.reportingCurrency).toBe("USD");
    expect(yield* settings.update(input)).toEqual(saved);
    expect(
      (yield* settings
        .update({
          ...input,
          commandId: CommandId.make(yield* Crypto.Crypto.use((crypto) => crypto.randomUUIDv4)),
          timezone: "Australia/Sydney",
        })
        .pipe(Effect.flip)).kind,
    ).toBe("stale");
    expect(yield* settings.get).toEqual(saved);
  }).pipe(Effect.provide(services)),
);

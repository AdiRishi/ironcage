import { Internal } from "@ironcage/contracts/schema";
import { Effect, References } from "effect";
import { expect, test } from "vitest";

import { PersistenceError, persistenceToBoundary } from "../../src/persistence/error";

test("persistence failures expose only their operation at the caller boundary", async () => {
  const failure = persistenceToBoundary(
    Effect.fail(
      new PersistenceError({
        operation: "read sleeve",
        cause: new Error("secret database detail"),
      }),
    ),
  ).pipe(Effect.provideService(References.MinimumLogLevel, "None"));
  const error = await Effect.runPromise(Effect.flip(failure));

  expect(error).toBeInstanceOf(Internal);
  expect(error.detail).toBe("read sleeve failed");
  expect(error.detail).not.toContain("secret database detail");
});

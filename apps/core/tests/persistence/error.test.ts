import { expect, it } from "@effect/vitest";
import { Internal } from "@ironcage/contracts/schema";
import { Effect } from "effect";

import { PersistenceError, persistenceToBoundary } from "../../src/persistence/error";

it.effect("persistence failures expose only their operation at the caller boundary", () =>
  Effect.gen(function* () {
    const failure = persistenceToBoundary(
      Effect.fail(
        new PersistenceError({
          operation: "read sleeve",
          cause: new Error("secret database detail"),
        }),
      ),
    );
    const error = yield* Effect.flip(failure);

    expect(error).toBeInstanceOf(Internal);
    expect(error.detail).toBe("read sleeve failed");
    expect(error.detail).not.toContain("secret database detail");
  }),
);

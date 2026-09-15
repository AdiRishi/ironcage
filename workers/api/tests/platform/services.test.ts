import { it } from "@effect/vitest";
import { ImportId } from "@repo/contracts/finance";
import { RuntimeContext } from "alchemy/RuntimeContext";
import { Effect, Ref } from "effect";
import { expect } from "vitest";

import { ImportJobs } from "../../src/platform/services.ts";

it.effect("job operations retain their binding context after initialization", () =>
  Effect.gen(function* () {
    const started = yield* Ref.make<string | null>(null);
    const runtime = RuntimeContext.of({
      Type: "Test",
      id: "import-worker",
      env: {},
      get: () => Effect.die("Unexpected environment lookup"),
      set: () => Effect.die("Unexpected binding registration"),
    });
    const jobs = yield* ImportJobs.pipe(
      Effect.provide(
        ImportJobs.layer({
          start: () => RuntimeContext.use((context) => Ref.set(started, context.id)),
          status: () =>
            RuntimeContext.use((context) =>
              Effect.succeed({ status: "running", failure: context.id }),
            ),
        }),
      ),
      Effect.provideService(RuntimeContext, runtime),
    );
    yield* jobs.start({
      importId: ImportId.make("00000000-0000-4000-8000-000000000001"),
      instanceId: "attempt",
    });
    expect(yield* Ref.get(started)).toBe("import-worker");
    expect(yield* jobs.status({ instanceId: "attempt" })).toEqual({
      status: "running",
      failure: "import-worker",
    });
  }),
);

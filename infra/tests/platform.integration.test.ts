import * as Alchemy from "alchemy";
import * as Test from "alchemy/Test/Vitest";
import { Effect } from "effect";
import { HttpClient } from "effect/unstable/http";
import { expect } from "vitest";

import { providers } from "../src/providers.ts";
import { workerGraph } from "../src/workers.ts";
import Driver from "./fixtures/api-driver.ts";
import { waitForWorker } from "./support/worker-readiness.ts";

const platformProviders = providers();
const Stack = Alchemy.Stack(
  "RecordsPlatformTest",
  { providers: platformProviders, state: Alchemy.localState() },
  Effect.gen(function* () {
    yield* workerGraph;
    const driver = yield* Driver;
    return { url: driver.url.as<string>() };
  }),
);
const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  providers: platformProviders,
  stage: `test-${crypto.randomUUID().slice(0, 8)}`,
  dev: true,
});
const stack = beforeAll(deploy(Stack), { timeout: 600_000 });
afterAll(destroy(Stack), { timeout: 600_000 });

test(
  "the private API reads the migrated accounts table through Hyperdrive",
  Effect.gen(function* () {
    const { url } = yield* stack;
    yield* waitForWorker(url);
    const response = yield* HttpClient.get(url);
    expect(response.status).toBe(200);
    expect(yield* response.json).toEqual([]);
  }),
);

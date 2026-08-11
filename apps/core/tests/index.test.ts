import { clientOverBinding, SystemRpcs, timeouts } from "@ironcage/contracts/client";
import { exports } from "cloudflare:workers";
import { Effect } from "effect";
import { expect, test } from "vitest";

import "../src/index";

const ping = (entrypoint: { fetch: (request: Request) => Promise<Response> }) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* clientOverBinding(SystemRpcs, {
        binding: {
          fetch: (input, init) => entrypoint.fetch(new Request(input as RequestInfo, init)),
        },
        surface: "core",
        timeout: timeouts.appToCore,
      });

      return yield* client.ping();
    }).pipe(Effect.scoped),
  );

test("the operator surface identifies itself", async () => {
  await expect(ping(exports.AppApiEntrypoint)).resolves.toMatchObject({
    worker: "ironcage-core",
    surface: "AppApi",
  });
});

test("the agent surface identifies itself", async () => {
  await expect(ping(exports.AgentReadApiEntrypoint)).resolves.toMatchObject({
    worker: "ironcage-core",
    surface: "AgentReadApi",
  });
});

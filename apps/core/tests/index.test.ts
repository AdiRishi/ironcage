import { AgentReadRpcs, AppRpcs, clientOverBinding, timeouts } from "@ironcage/contracts";
import { exports } from "cloudflare:workers";
import { Effect } from "effect";
import { expect, test } from "vitest";

import "../src/index";

const ping = (
  entrypoint: { fetch: (request: Request) => Promise<Response> },
  group: typeof AppRpcs,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* clientOverBinding(group, {
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
  await expect(ping(exports.AppApiEntrypoint, AppRpcs)).resolves.toMatchObject({
    worker: "ironcage-core",
    surface: "AppApi",
  });
});

test("the agent surface identifies itself", async () => {
  await expect(ping(exports.AgentReadApiEntrypoint, AgentReadRpcs)).resolves.toMatchObject({
    worker: "ironcage-core",
    surface: "AgentReadApi",
  });
});

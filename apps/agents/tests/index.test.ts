import { ConversationRpcs, DispatchRpcs, clientOverBinding, timeouts } from "@ironcage/contracts";
import { exports } from "cloudflare:workers";
import { Effect } from "effect";
import { expect, test } from "vitest";

import "../src/index";

const ping = (
  entrypoint: { fetch: (request: Request) => Promise<Response> },
  group: typeof ConversationRpcs,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* clientOverBinding(group, {
        binding: {
          fetch: (input, init) => entrypoint.fetch(new Request(input as RequestInfo, init)),
        },
        surface: "agents",
        timeout: timeouts.appToAgents,
      });

      return yield* client.ping();
    }).pipe(Effect.scoped),
  );

test("the conversation surface identifies itself", async () => {
  await expect(ping(exports.ConversationApiEntrypoint, ConversationRpcs)).resolves.toMatchObject({
    worker: "ironcage-agents",
    surface: "ConversationApi",
  });
});

test("the dispatch surface identifies itself", async () => {
  await expect(ping(exports.DispatchApiEntrypoint, DispatchRpcs)).resolves.toMatchObject({
    worker: "ironcage-agents",
    surface: "DispatchApi",
  });
});

import { expect, it } from "@effect/vitest";
import {
  ConversationRpcs,
  DispatchRpcs,
  clientOverBinding,
  timeouts,
} from "@ironcage/contracts/client";
import { exports } from "cloudflare:workers";
import { Effect } from "effect";

import "../src/index";

const ping = (
  entrypoint: { fetch: (request: Request) => Promise<Response> },
  group: typeof ConversationRpcs,
) =>
  Effect.gen(function* () {
    const client = yield* clientOverBinding(group, {
      binding: {
        fetch: (input, init) => entrypoint.fetch(new Request(input as RequestInfo, init)),
      },
      surface: "agents",
      timeout: timeouts.appToAgents,
    });

    return yield* client.ping();
  });

it.effect("the conversation surface identifies itself", () =>
  Effect.gen(function* () {
    const result = yield* ping(exports.ConversationApiEntrypoint, ConversationRpcs);

    expect(result).toMatchObject({
      worker: "ironcage-agents",
      surface: "ConversationApi",
    });
  }),
);

it.effect("the dispatch surface identifies itself", () =>
  Effect.gen(function* () {
    const result = yield* ping(exports.DispatchApiEntrypoint, DispatchRpcs);

    expect(result).toMatchObject({
      worker: "ironcage-agents",
      surface: "DispatchApi",
    });
  }),
);

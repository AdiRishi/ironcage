import { expect, it } from "@effect/vitest";
import {
  ConversationRpcs,
  DispatchRpcs,
  clientOverBinding,
  timeouts,
} from "@ironcage/contracts/client";
import { exports } from "cloudflare:workers";
import { Effect } from "effect";
import type { Rpc, RpcGroup } from "effect/unstable/rpc";

import "../src/cloudflare";

const clientFor = <Rpcs extends Rpc.Any>(
  entrypoint: { fetch: (request: Request) => Promise<Response> },
  group: RpcGroup.RpcGroup<Rpcs>,
) =>
  clientOverBinding(group, {
    binding: {
      fetch: (input, init) => entrypoint.fetch(new Request(input, init)),
    },
    surface: "agents",
    timeout: timeouts.appToAgents,
  });

it.effect("the conversation surface identifies itself", () =>
  Effect.gen(function* () {
    const client = yield* clientFor(exports.ConversationApiEntrypoint, ConversationRpcs);
    const result = yield* client.ping();

    expect(result).toMatchObject({
      worker: "ironcage-agents",
      surface: "ConversationApi",
    });
  }),
);

it.effect("the dispatch surface identifies itself", () =>
  Effect.gen(function* () {
    const client = yield* clientFor(exports.DispatchApiEntrypoint, DispatchRpcs);
    const result = yield* client.ping();

    expect(result).toMatchObject({
      worker: "ironcage-agents",
      surface: "DispatchApi",
    });
  }),
);

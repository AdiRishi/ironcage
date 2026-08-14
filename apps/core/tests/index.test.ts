import { expect, it } from "@effect/vitest";
import { AgentReadRpcs, AppRpcs, clientOverBinding, timeouts } from "@ironcage/contracts/client";
import { exports } from "cloudflare:workers";
import { Effect } from "effect";
import type { Rpc, RpcGroup } from "effect/unstable/rpc";

import "../src/index";

const clientFor = <Rpcs extends Rpc.Any>(
  entrypoint: { fetch: (request: Request) => Promise<Response> },
  group: RpcGroup.RpcGroup<Rpcs>,
) =>
  clientOverBinding(group, {
    binding: {
      fetch: (input, init) => entrypoint.fetch(new Request(input as RequestInfo, init)),
    },
    surface: "core",
    timeout: timeouts.appToCore,
  });

it.effect("the operator surface identifies itself", () =>
  Effect.gen(function* () {
    const client = yield* clientFor(exports.AppApiEntrypoint, AppRpcs);
    const result = yield* client.ping();

    expect(result).toMatchObject({
      worker: "ironcage-core",
      surface: "AppApi",
    });
  }),
);

it.effect("the agent surface identifies itself", () =>
  Effect.gen(function* () {
    const client = yield* clientFor(exports.AgentReadApiEntrypoint, AgentReadRpcs);
    const result = yield* client.ping();

    expect(result).toMatchObject({
      worker: "ironcage-core",
      surface: "AgentReadApi",
    });
  }),
);

import { expect, it } from "@effect/vitest";
import { AgentReadRpcs, AppRpcs, clientOverBinding, timeouts } from "@ironcage/contracts/client";
import { exports } from "cloudflare:workers";
import { Effect } from "effect";

import "../src/index";

const ping = (
  entrypoint: { fetch: (request: Request) => Promise<Response> },
  group: typeof AppRpcs,
) =>
  Effect.gen(function* () {
    const client = yield* clientOverBinding(group, {
      binding: {
        fetch: (input, init) => entrypoint.fetch(new Request(input as RequestInfo, init)),
      },
      surface: "core",
      timeout: timeouts.appToCore,
    });

    return yield* client.ping();
  });

it.effect("the operator surface identifies itself", () =>
  Effect.gen(function* () {
    const result = yield* ping(exports.AppApiEntrypoint, AppRpcs);

    expect(result).toMatchObject({
      worker: "ironcage-core",
      surface: "AppApi",
    });
  }),
);

it.effect("the agent surface identifies itself", () =>
  Effect.gen(function* () {
    const result = yield* ping(exports.AgentReadApiEntrypoint, AgentReadRpcs);

    expect(result).toMatchObject({
      worker: "ironcage-core",
      surface: "AgentReadApi",
    });
  }),
);

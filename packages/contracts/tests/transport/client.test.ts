import { describe, expect, it } from "@effect/vitest";
import type { Duration } from "effect";
import { DateTime, Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import type { Rpc, RpcGroup } from "effect/unstable/rpc";
import { RpcGroup as RpcGroupModule } from "effect/unstable/rpc";

import { clientOverBinding, intoTaxonomy, timeouts, type ServiceBinding } from "../../src/client";
import { Internal } from "../../src/schema";
import { rpcHttpRoute, systemPingHandler } from "../../src/server";
import { systemPingRpc } from "../../src/surfaces/system";

// Transport behavior only needs one representative operation; the full
// surfaces have their own conformance tests.
const PingRpcs = RpcGroupModule.make(systemPingRpc);

const serverWith = (handlers: Layer.Layer<Rpc.ToHandler<RpcGroup.Rpcs<typeof PingRpcs>>>) =>
  Effect.acquireRelease(
    Effect.sync(() =>
      HttpRouter.toWebHandler(rpcHttpRoute(PingRpcs, handlers), { disableLogger: true }),
    ),
    (server) => Effect.promise(() => server.dispose()),
  );

const bindingTo = (handler: (request: Request) => Promise<Response>): ServiceBinding => ({
  fetch: (input, init) => handler(new Request(input, init)),
});

const callPing = (binding: ServiceBinding, timeout: Duration.Input = timeouts.appToCore) =>
  Effect.gen(function* () {
    const client = yield* clientOverBinding(PingRpcs, { binding, surface: "core", timeout });

    return yield* intoTaxonomy(client.ping());
  });

describe("clientOverBinding", () => {
  it.effect("decodes a success from the other Worker", () =>
    Effect.gen(function* () {
      const server = yield* serverWith(
        PingRpcs.toLayer({
          ping: () => systemPingHandler({ worker: "ironcage-core", surface: "AppApi" }),
        }),
      );
      const ping = yield* callPing(bindingTo(server.handler));

      expect(ping.worker).toBe("ironcage-core");
      expect(ping.surface).toBe("AppApi");
      expect(DateTime.isDateTime(ping.serverTime)).toBe(true);
    }),
  );

  it.effect("carries a declared error across as a typed value", () =>
    Effect.gen(function* () {
      const server = yield* serverWith(
        PingRpcs.toLayer({
          ping: () => Effect.fail(new Internal({ detail: "hyperdrive unreachable" })),
        }),
      );
      const result = yield* Effect.flip(callPing(bindingTo(server.handler)));

      expect(result).toBeInstanceOf(Internal);
      expect(result.detail).toBe("hyperdrive unreachable");
    }),
  );

  // `it.live` because the budget is wall-clock and the other cases run on the
  // test clock, which never advances on its own.
  it.live("fails a call that outlives its budget", () =>
    Effect.gen(function* () {
      const server = yield* serverWith(PingRpcs.toLayer({ ping: () => Effect.never }));
      const result = yield* Effect.flip(callPing(bindingTo(server.handler), "20 millis"));

      expect(result).toBeInstanceOf(Internal);
      expect(result.detail).toContain("no answer within 20ms");
      expect(result.detail).toContain("POST http://core.ironcage.internal/rpc");
    }),
  );
});

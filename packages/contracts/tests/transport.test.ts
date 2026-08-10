import { it } from "@effect/vitest";
import type { Duration } from "effect";
import { DateTime, Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import type { Rpc, RpcGroup } from "effect/unstable/rpc";
import { describe, expect } from "vitest";

import { Internal } from "../src/errors";
import { rpcHttpRoute, systemPingHandler } from "../src/serve";
import { AppRpcs } from "../src/surfaces";
import type { ServiceBinding } from "../src/transport";
import { clientOverBinding, intoTaxonomy, timeouts } from "../src/transport";

const serverWith = (handlers: Layer.Layer<Rpc.ToHandler<RpcGroup.Rpcs<typeof AppRpcs>>>) =>
  HttpRouter.toWebHandler(rpcHttpRoute(AppRpcs, handlers), { disableLogger: true });

// What workerd hands a caller: a `fetch` into another Worker's fetch handler.
const bindingTo = (handler: (request: Request) => Promise<Response>): ServiceBinding => ({
  fetch: (input, init) => handler(new Request(input as RequestInfo, init)),
});

const callPing = (binding: ServiceBinding, timeout: Duration.Input = timeouts.appToCore) =>
  Effect.gen(function* () {
    const client = yield* clientOverBinding(AppRpcs, { binding, surface: "core", timeout });

    return yield* intoTaxonomy(client.ping());
  }).pipe(Effect.scoped);

describe("clientOverBinding", () => {
  it.effect("decodes a success from the other Worker", () =>
    Effect.gen(function* () {
      const server = serverWith(
        AppRpcs.toLayer({
          ping: () => systemPingHandler({ worker: "ironcage-core", surface: "AppApi" }),
        }),
      );
      const ping = yield* callPing(bindingTo(server.handler));

      expect(ping.worker).toBe("ironcage-core");
      expect(ping.surface).toBe("AppApi");
      expect(DateTime.isDateTime(ping.serverTime)).toBe(true);

      yield* Effect.promise(() => server.dispose());
    }),
  );

  it.effect("carries a declared error across as a typed value", () =>
    Effect.gen(function* () {
      const server = serverWith(
        AppRpcs.toLayer({
          ping: () => Effect.fail(new Internal({ detail: "hyperdrive unreachable" })),
        }),
      );
      const result = yield* Effect.flip(callPing(bindingTo(server.handler)));

      expect(result).toBeInstanceOf(Internal);
      expect(result.detail).toBe("hyperdrive unreachable");

      yield* Effect.promise(() => server.dispose());
    }),
  );

  // `it.live` because the budget is wall-clock and the other cases run on the
  // test clock, which never advances on its own.
  it.live("fails a call that outlives its budget", () =>
    Effect.gen(function* () {
      const server = serverWith(AppRpcs.toLayer({ ping: () => Effect.never }));
      const result = yield* Effect.flip(callPing(bindingTo(server.handler), "20 millis"));

      expect(result).toBeInstanceOf(Internal);

      yield* Effect.promise(() => server.dispose());
    }),
  );
});

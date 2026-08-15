import type { AppClient } from "@ironcage/contracts/client";
import { AppRpcs, clientOverBinding, intoTaxonomy, timeouts } from "@ironcage/contracts/client";
import { SystemPing } from "@ironcage/contracts/schema";
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { Effect, Schema } from "effect";

/** Effect stops at this boundary; the browser sees whatever a server function returns. */
export const callCore = <A, E>(
  use: (client: AppClient) => Effect.Effect<A, E>,
  options?: { readonly timeout?: (typeof timeouts)[keyof typeof timeouts] },
): Promise<A> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* clientOverBinding(AppRpcs, {
        binding: env.CORE,
        surface: "core",
        timeout: options?.timeout ?? timeouts.appToCore,
      });

      return yield* use(client);
    }).pipe(Effect.scoped),
  );

export const getSystemPing = createServerFn().handler(() =>
  // A server function's result is serialized on its way to the browser, and
  // the encoded form is what the schema says that looks like.
  callCore((client) => intoTaxonomy(client.ping()).pipe(Effect.map(Schema.encodeSync(SystemPing)))),
);

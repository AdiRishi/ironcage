import type { AppClient } from "@ironcage/contracts/client";
import { AppRpcs, clientOverBinding, timeouts } from "@ironcage/contracts/client";
import { env } from "cloudflare:workers";
import { Effect } from "effect";

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

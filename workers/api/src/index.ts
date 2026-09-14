import type { apiBindings } from "@repo/infra/worker-bindings";
import { Effect, Layer } from "effect";

import { Accounts } from "./accounts/service.ts";

export const api = Effect.fn("Api.initialize")(function* (
  bindings: Effect.Success<ReturnType<typeof apiBindings>>,
) {
  const accounts = yield* Accounts.pipe(
    Effect.provide(Accounts.layer.pipe(Layer.provide(bindings.database))),
  );
  return { listAccounts: accounts.list };
});

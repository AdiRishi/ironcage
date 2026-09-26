import type { RpcCallError } from "alchemy/Cloudflare/Bridge";
import type { Effect } from "effect";

// Operations as another Worker's binding reaches them. The Worker that serves them
// provides their services, so only results and failures cross, and a call also fails with
// `RpcCallError` when that Worker throws, runs out of CPU, restarts, or loses the
// connection.
export type WorkerClient<Operations> = {
  readonly [K in keyof Operations]: Operations[K] extends (
    ...args: infer Args
  ) => Effect.Effect<infer A, infer E>
    ? (...args: Args) => Effect.Effect<A, E | RpcCallError>
    : never;
};

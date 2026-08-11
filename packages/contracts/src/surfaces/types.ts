import type { Rpc } from "effect/unstable/rpc";

/** What a procedure returns and accepts, derived from its definition rather than restated. */
export type Output<R extends Rpc.Any> = Rpc.Success<R>;
export type Input<R extends Rpc.Any> = Rpc.Payload<R>;

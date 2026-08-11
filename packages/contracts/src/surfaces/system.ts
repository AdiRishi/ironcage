import { DateTime, Effect, Schema } from "effect";
import { Rpc as RpcModule } from "effect/unstable/rpc";
import { RpcGroup } from "effect/unstable/rpc";

import { Internal } from "./errors";

/**
 * What every Worker answers `ping` with. It names the surface as well as the
 * Worker because a binding pointed at the wrong entrypoint still answers, and
 * the surface name is the only thing that distinguishes it from a correct one.
 */
export const SystemPing = Schema.Struct({
  worker: Schema.String,
  surface: Schema.String,
  serverTime: Schema.DateTimeUtcFromString,
});
export type SystemPing = typeof SystemPing.Type;

export const systemPingRpc = RpcModule.make("ping", { success: SystemPing, error: Internal });
export const SystemRpcs = RpcGroup.make(systemPingRpc);

export const systemPingHandler = (identity: {
  readonly worker: string;
  readonly surface: string;
}) => Effect.map(DateTime.now, (serverTime) => ({ ...identity, serverTime }));

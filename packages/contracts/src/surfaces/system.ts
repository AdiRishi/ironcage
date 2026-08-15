import { Instant, RequestId, SystemMode } from "@ironcage/domain";
import { DateTime, Effect, Schema } from "effect";
import { Rpc as RpcModule } from "effect/unstable/rpc";

import { Conflict, Internal, ValidationFailed } from "./errors";

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

export const SystemStatus = Schema.Struct({
  mode: SystemMode,
  reason: Schema.NullOr(Schema.String),
  changedAt: Instant,
  unacknowledgedCriticals: Schema.Int,
});
export type SystemStatus = typeof SystemStatus.Type;

export const getSystemStatusRpc = RpcModule.make("getSystemStatus", {
  success: SystemStatus,
  error: Internal,
});

export const HaltAllInput = Schema.Struct({ requestId: RequestId, reason: Schema.String });

export const haltAllRpc = RpcModule.make("haltAll", {
  payload: HaltAllInput.fields,
  success: SystemStatus,
  error: Schema.Union([ValidationFailed, Conflict, Internal]),
});

export const systemPingHandler = (identity: {
  readonly worker: string;
  readonly surface: string;
}) => Effect.map(DateTime.now, (serverTime) => ({ ...identity, serverTime }));

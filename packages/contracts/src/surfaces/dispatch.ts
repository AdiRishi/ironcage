import { Schema } from "effect";
import { Rpc as RpcModule } from "effect/unstable/rpc";
import { RpcGroup } from "effect/unstable/rpc";

import { CategorizationDispatch } from "../ai/capability-run";
import { Internal } from "./errors";
import { systemPingRpc } from "./system";

/**
 * Core dispatches a categorization batch; the run's answer returns on the
 * decision-records queue, never on this call. `accepted` only means the
 * agents Worker took the run.
 */
export const dispatchCategorizationRpc = RpcModule.make("dispatchCategorization", {
  payload: CategorizationDispatch.fields,
  success: Schema.Struct({ accepted: Schema.Boolean }),
  error: Internal,
});

/** Served by agents, called by core. Capability dispatch; results return on the queue. */
export const DispatchRpcs = RpcGroup.make(systemPingRpc, dispatchCategorizationRpc);

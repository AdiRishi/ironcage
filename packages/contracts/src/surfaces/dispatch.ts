import { RpcGroup } from "effect/unstable/rpc";

import { systemPingRpc } from "./system";

/** Served by agents, called by core. Capability dispatch; results return on the queue. */
export const DispatchRpcs = RpcGroup.make(systemPingRpc);

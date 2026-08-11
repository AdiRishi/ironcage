import { RpcGroup } from "effect/unstable/rpc";

import { systemPingRpc } from "./system";

/** Served by core, called by agents. Read-only. */
export const AgentReadRpcs = RpcGroup.make(systemPingRpc);

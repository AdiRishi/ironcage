import { RpcGroup } from "effect/unstable/rpc";

import { systemPingRpc } from "./system";

/** Served by agents, called by the app. Research conversations; no mutation. */
export const ConversationRpcs = RpcGroup.make(systemPingRpc);

import { RpcGroup } from "effect/unstable/rpc";

import { systemPingRpc } from "./system";

/** Served by core, called by the app. The operator surface. */
export const AppRpcs = RpcGroup.make(systemPingRpc);

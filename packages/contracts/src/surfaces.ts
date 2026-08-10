import type { Rpc } from "effect/unstable/rpc";
import { Rpc as RpcModule, RpcGroup } from "effect/unstable/rpc";

import { Internal } from "./errors";
import { SystemPing } from "./system";

const ping = RpcModule.make("ping", { success: SystemPing, error: Internal });

/** Served by core, called by the app. The operator surface. */
export const AppRpcs = RpcGroup.make(ping);

/** Served by core, called by agents. Read-only. */
export const AgentReadRpcs = RpcGroup.make(ping);

/** Served by agents, called by the app. Research conversations; no mutation. */
export const ConversationRpcs = RpcGroup.make(ping);

/** Served by agents, called by core. Capability dispatch; results return on the queue. */
export const DispatchRpcs = RpcGroup.make(ping);

/** What a procedure returns and accepts, derived from its definition rather than restated. */
export type Output<R extends Rpc.Any> = Rpc.Success<R>;
export type Input<R extends Rpc.Any> = Rpc.Payload<R>;

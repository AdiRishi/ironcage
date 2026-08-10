import type { RpcClient, RpcClientError, RpcGroup } from "effect/unstable/rpc";

import type { AgentReadRpcs, AppRpcs, ConversationRpcs, DispatchRpcs } from "./surfaces";

/** The client a group produces. */
export type ClientFor<Group> = RpcClient.RpcClient<
  RpcGroup.Rpcs<Group>,
  RpcClientError.RpcClientError
>;

export type AppClient = ClientFor<typeof AppRpcs>;
export type AgentReadClient = ClientFor<typeof AgentReadRpcs>;
export type ConversationClient = ClientFor<typeof ConversationRpcs>;
export type DispatchClient = ClientFor<typeof DispatchRpcs>;

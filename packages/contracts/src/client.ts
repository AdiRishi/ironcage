import type { AgentReadRpcs } from "./surfaces/agent-read";
import type { AppRpcs } from "./surfaces/app";
import type { ConversationRpcs } from "./surfaces/conversation";
import type { DispatchRpcs } from "./surfaces/dispatch";
import type { ClientFor } from "./transport/client";

export * from "./surfaces/agent-read";
export * from "./surfaces/app";
export * from "./surfaces/conversation";
export * from "./surfaces/dispatch";
export * from "./surfaces/types";
export * from "./transport/client";

export type AppClient = ClientFor<typeof AppRpcs>;
export type AgentReadClient = ClientFor<typeof AgentReadRpcs>;
export type ConversationClient = ClientFor<typeof ConversationRpcs>;
export type DispatchClient = ClientFor<typeof DispatchRpcs>;

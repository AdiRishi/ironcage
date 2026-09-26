import {
  Ask,
  BriefingInput,
  ConversationInput,
  ListConversations,
  ProposalInput,
  ResolveProposal,
} from "@repo/contracts/analyst";
import { createServerFn } from "@tanstack/react-start";
import { Schema } from "effect";

import { callAnalystRpc } from "@/server/analyst-client.server";

export const listConversations = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(ListConversations))
  .handler(({ data }) => callAnalystRpc((client) => client.listConversations(data)));
export const getConversation = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(ConversationInput))
  .handler(({ data }) => callAnalystRpc((client) => client.getConversation(data)));
export const ask = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(Ask))
  .handler(({ data }) => callAnalystRpc((client) => client.ask(data)));
export const resolveProposal = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(ResolveProposal))
  .handler(({ data }) => callAnalystRpc((client) => client.resolveProposal(data)));
export const refreshProposal = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(ProposalInput))
  .handler(({ data }) => callAnalystRpc((client) => client.refreshProposal(data)));
export const getBriefing = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(BriefingInput))
  .handler(({ data }) => callAnalystRpc((client) => client.getBriefing(data)));
export const requestBriefing = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(BriefingInput))
  .handler(({ data }) => callAnalystRpc((client) => client.requestBriefing(data)));
export const listBriefings = createServerFn({ method: "GET" }).handler(() =>
  callAnalystRpc((client) => client.listBriefings()),
);

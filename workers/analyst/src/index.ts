import type {
  Ask,
  ConversationInput,
  ListConversations,
  ProposalInput,
  ResolveProposal,
} from "@repo/contracts/analyst";
import type { Conversations } from "@repo/infra/analyst";
import type { Effect } from "effect";

// Every call goes to the one Conversations object, which holds the conversations about
// the ledger.
export const analyst = (namespace: Effect.Success<typeof Conversations>) => {
  // Resolved on each call: while Alchemy plans the stack, the namespace does not exist.
  const ledger = () => namespace.getByName("ledger");
  return {
    listConversations: (input: typeof ListConversations.Type) => ledger().listConversations(input),
    getConversation: (input: typeof ConversationInput.Type) => ledger().getConversation(input),
    ask: (input: Ask) => ledger().ask(input),
    resolveProposal: (input: ResolveProposal) => ledger().resolveProposal(input),
    refreshProposal: (input: typeof ProposalInput.Type) => ledger().refreshProposal(input),
  };
};
export type AnalystOperations = ReturnType<typeof analyst>;

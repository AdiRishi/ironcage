import type { Ask, AskContext, Conversation, ConversationId } from "@repo/contracts/analyst";
import { CommandId } from "@repo/contracts/finance";
import { useQueryClient } from "@tanstack/react-query";

import { useCommand } from "@/lib/use-command";

import { ask } from "./functions";
import { conversationQuery, conversationsQuery } from "./queries";

// Asks a question in a conversation, or in a new one when `conversationId` is null. The
// conversation the reply holds goes straight into the cache, so the queued question shows
// and starts polling without waiting for a refetch.
export function useAsk(
  conversationId: ConversationId | null,
  {
    onAsked,
    onFailed,
  }: { onAsked?: (conversation: Conversation) => void; onFailed?: (error: Error) => void } = {},
) {
  const client = useQueryClient();
  const command = useCommand({
    mutationFn: (data: Ask) => ask({ data }),
    onSuccess: async (conversation) => {
      client.setQueryData(conversationQuery(conversation.id).queryKey, conversation);
      onAsked?.(conversation);
      await client.invalidateQueries({ queryKey: conversationsQuery().queryKey });
    },
    onError: (error) => onFailed?.(error),
  });
  return {
    ...command,
    ask: (question: string, context: AskContext | null) =>
      command.submit({
        commandId: CommandId.make(crypto.randomUUID()),
        conversationId,
        question,
        context,
      }),
  };
}

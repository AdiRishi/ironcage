import type { ConversationCursor, ConversationId, TurnStatus } from "@repo/contracts/analyst";
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";

import { getConversation, listConversations } from "./functions";

// A question the analyst has not finished with yet.
export const waiting = (status: TurnStatus) => status === "queued" || status === "running";

// Conversations, most recently asked first, one page after another. Polls while one is
// being answered, so the list shows when it is done.
export const conversationsQuery = () =>
  infiniteQueryOptions({
    queryKey: ["listConversations", "pages"],
    initialPageParam: null,
    queryFn: ({ pageParam }: { pageParam: typeof ConversationCursor.Type | null }) =>
      listConversations({ data: pageParam ? { cursor: pageParam } : {} }),
    getNextPageParam: (page) => page.nextCursor,
    refetchInterval: (query) =>
      query.state.data?.pages.some((page) => page.rows.some((row) => row.answering)) ? 1000 : false,
  });

// Polls every second while a question in it is queued or running, so each step the
// analyst takes shows, and then the answer.
export const conversationQuery = (conversationId: ConversationId) =>
  queryOptions({
    queryKey: ["getConversation", { conversationId }],
    queryFn: () => getConversation({ data: { conversationId } }),
    refetchInterval: (query) =>
      query.state.data?.turns.some((turn) => waiting(turn.status)) ? 1000 : false,
  });

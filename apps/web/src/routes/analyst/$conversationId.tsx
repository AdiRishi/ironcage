import { ConversationId } from "@repo/contracts/analyst";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { ConversationView } from "@/features/analyst/conversation";
import { conversationQuery } from "@/features/analyst/queries";
import { postingQueryOptions } from "@/features/ledger/queries";
import { modelSettingsQuery } from "@/features/models/queries";
import { addressNotFound, pathParam } from "@/lib/address";

export const Route = createFileRoute("/analyst/$conversationId")({
  params: {
    parse: ({ conversationId }) => ({ conversationId: pathParam(ConversationId, conversationId) }),
  },
  onError: addressNotFound,
  loader: async ({ context, params }) => {
    const conversation = await context.queryClient.ensureQueryData(
      conversationQuery(params.conversationId),
    );
    // A transaction's chip names it by what the bank printed.
    await Promise.all(
      conversation.turns.flatMap((turn) =>
        turn.context?.kind === "transaction"
          ? [
              context.queryClient.prefetchQuery(
                postingQueryOptions({ postingId: turn.context.postingId }),
              ),
            ]
          : [],
      ),
    );
  },
  component: ConversationRoute,
});

function ConversationRoute() {
  const { conversationId } = Route.useParams();
  const { data: conversation } = useSuspenseQuery(conversationQuery(conversationId));
  const { data: settings } = useSuspenseQuery(modelSettingsQuery());
  return (
    <ConversationView
      key={conversation.id}
      conversation={conversation}
      enabled={settings.analyst.enabled}
    />
  );
}

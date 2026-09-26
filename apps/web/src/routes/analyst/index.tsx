import { useSuspenseInfiniteQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Schema } from "effect";

import { NewQuestion } from "@/features/analyst/page";
import { conversationsQuery } from "@/features/analyst/queries";
import { NewQuestionSearch } from "@/features/analyst/search";
import { postingQueryOptions } from "@/features/ledger/queries";
import { modelSettingsQuery } from "@/features/models/queries";
import { addressNotFound } from "@/lib/address";

export const Route = createFileRoute("/analyst/")({
  validateSearch: Schema.toStandardSchemaV1(NewQuestionSearch),
  onError: addressNotFound,
  loaderDeps: ({ search }) => ({ about: search.about }),
  // A transaction's chip names it by what the bank printed.
  loader: ({ context, deps }) =>
    deps.about?.kind === "transaction"
      ? context.queryClient.prefetchQuery(postingQueryOptions({ postingId: deps.about.postingId }))
      : undefined,
  component: NewQuestionRoute,
});

function NewQuestionRoute() {
  const { about } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data: settings } = useSuspenseQuery(modelSettingsQuery());
  const { data: conversations } = useSuspenseInfiniteQuery(conversationsQuery());
  return (
    <NewQuestion
      context={about ?? null}
      enabled={settings.analyst.enabled}
      first={conversations.pages.every((page) => page.rows.length === 0)}
      onRemoveContext={() => {
        navigate({ search: (previous) => ({ ...previous, about: undefined }) }).catch(reportError);
      }}
      onAsked={(conversation) => {
        navigate({
          to: "/analyst/$conversationId",
          params: { conversationId: conversation.id },
        }).catch(reportError);
      }}
    />
  );
}

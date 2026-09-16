import { createFileRoute } from "@tanstack/react-router";

import { SavedAnalysesPage } from "@/features/analysis/saved-list";
import { analysesQuery } from "@/features/analysis/saved-queries";

export const Route = createFileRoute("/trends_/analyses")({
  loader: ({ context }) => context.queryClient.fetchQuery(analysesQuery()),
  component: SavedAnalysesPage,
});

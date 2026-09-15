import { createFileRoute } from "@tanstack/react-router";

import { referenceDataQuery } from "@/features/events/queries";
import { ReferencesPage } from "@/features/references/page";
export const Route = createFileRoute("/settings_/categories")({
  loader: ({ context }) => context.queryClient.ensureQueryData(referenceDataQuery()),
  component: ReferencesPage,
});

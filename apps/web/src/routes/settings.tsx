import { createFileRoute } from "@tanstack/react-router";

import { accountsQueryOptions } from "@/features/accounts/queries";
import { SettingsPage } from "@/features/settings/page";
import { settingsQueryOptions, retentionQueryOptions } from "@/features/settings/queries";

export const Route = createFileRoute("/settings")({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(accountsQueryOptions()),
      context.queryClient.ensureQueryData(settingsQueryOptions()),
      context.queryClient.ensureQueryData(retentionQueryOptions()),
    ]),
  component: SettingsPage,
});

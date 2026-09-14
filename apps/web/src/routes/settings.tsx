import { createFileRoute } from "@tanstack/react-router";

import { accountsQueryOptions } from "@/features/accounts/queries";
import { exportsQueryOptions } from "@/features/exports/section";
import { modelUsageQueryOptions } from "@/features/settings/model-usage";
import { SettingsPage } from "@/features/settings/page";
import { settingsQueryOptions, retentionQueryOptions } from "@/features/settings/queries";
import { sourceFilesQueryOptions } from "@/features/sources/section";

export const Route = createFileRoute("/settings")({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(sourceFilesQueryOptions()),
      context.queryClient.ensureQueryData(modelUsageQueryOptions()),
      context.queryClient.ensureQueryData(exportsQueryOptions()),
      context.queryClient.ensureQueryData(accountsQueryOptions()),
      context.queryClient.ensureQueryData(settingsQueryOptions()),
      context.queryClient.ensureQueryData(retentionQueryOptions()),
    ]),
  component: SettingsPage,
});

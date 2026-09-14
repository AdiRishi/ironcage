import { createFileRoute } from "@tanstack/react-router";

import { accountsQueryOptions } from "@/features/accounts/queries";
import { ImportsPage } from "@/features/imports/page";
import { importsQueryOptions } from "@/features/imports/queries";
export const Route = createFileRoute("/imports")({
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(accountsQueryOptions()),
      context.queryClient.ensureQueryData(importsQueryOptions()),
    ]);
  },
  component: ImportsPage,
});

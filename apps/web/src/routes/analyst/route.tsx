import { Outlet, createFileRoute, useMatch } from "@tanstack/react-router";

import { AnalystPage } from "@/features/analyst/page";
import { conversationsQuery } from "@/features/analyst/queries";
import { referenceDataQuery } from "@/features/events/queries";
import { modelSettingsQuery } from "@/features/models/queries";
import { settingsQueryOptions } from "@/features/settings/queries";

export const Route = createFileRoute("/analyst")({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureInfiniteQueryData(conversationsQuery()),
      context.queryClient.ensureQueryData(modelSettingsQuery()),
      context.queryClient.ensureQueryData(referenceDataQuery()),
      context.queryClient.ensureQueryData(settingsQueryOptions()),
    ]),
  component: Analyst,
});

function Analyst() {
  const open = useMatch({ from: "/analyst/$conversationId", shouldThrow: false });
  return (
    <AnalystPage open={open?.params.conversationId ?? null}>
      <Outlet />
    </AnalystPage>
  );
}

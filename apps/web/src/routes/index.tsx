import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { periodFlowQuery } from "@/features/flow/queries";
import { OverviewPage } from "@/features/overview/page";
import { questionsQuery } from "@/features/questions/queries";
import { settingsQueryOptions } from "@/features/settings/queries";
import { flowInput, resolvePeriodKey } from "@/lib/period";

export const Route = createFileRoute("/")({
  loaderDeps: ({ search }) => ({ period: search.period }),
  loader: async ({ context, deps }) => {
    const settings = await context.queryClient.ensureQueryData(settingsQueryOptions());
    await context.queryClient.ensureQueryData(
      periodFlowQuery(flowInput(resolvePeriodKey(deps.period), settings.reportingCurrency)),
    );
  },
  component: Overview,
});

function Overview() {
  const { data: settings } = useSuspenseQuery(settingsQueryOptions());
  const period = resolvePeriodKey(Route.useSearch().period);
  const { data: flow } = useSuspenseQuery(
    periodFlowQuery(flowInput(period, settings.reportingCurrency)),
  );
  const { data: questions } = useSuspenseQuery(questionsQuery(settings.reportingCurrency));
  return <OverviewPage flow={flow} period={period} questions={questions} />;
}

import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { monthlyFlowQuery, periodFlowQuery } from "@/features/flow/queries";
import { OverviewPage } from "@/features/overview/page";
import { questionsQuery } from "@/features/questions/queries";
import { settingsQueryOptions } from "@/features/settings/queries";
import { flowInput, resolvePeriodKey, today } from "@/lib/period";

export const Route = createFileRoute("/")({
  loaderDeps: ({ search }) => ({ period: search.period, compare: search.compare }),
  loader: async ({ context, deps }) => {
    const settings = await context.queryClient.ensureQueryData(settingsQueryOptions());
    await context.queryClient.ensureQueryData(
      periodFlowQuery(
        flowInput(
          resolvePeriodKey(deps.period, settings.timezone),
          deps.compare,
          settings.reportingCurrency,
        ),
      ),
    );
  },
  component: Overview,
});

function Overview() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data: settings } = useSuspenseQuery(settingsQueryOptions());
  const period = resolvePeriodKey(search.period, settings.timezone);
  const { data: flow } = useSuspenseQuery(
    periodFlowQuery(flowInput(period, search.compare, settings.reportingCurrency)),
  );
  const { data: questions } = useSuspenseQuery(questionsQuery(settings.reportingCurrency));
  const { data: months } = useSuspenseQuery(monthlyFlowQuery(settings.reportingCurrency));
  return (
    <OverviewPage
      flow={flow}
      period={period}
      compare={search.compare}
      onCompare={(compare) => {
        navigate({ search: (previous) => ({ ...previous, compare }) }).catch(reportError);
      }}
      firstMonth={months[0]?.month ?? period.from}
      today={today(settings.timezone)}
      questions={questions}
    />
  );
}

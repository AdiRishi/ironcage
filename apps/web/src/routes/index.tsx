import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { monthlyFlowQuery, periodFlowQuery } from "@/features/flow/queries";
import { OverviewPage } from "@/features/overview/page";
import { questionSummaryQuery } from "@/features/questions/queries";
import { settingsQueryOptions } from "@/features/settings/queries";
import { flowInput, periodSelection, resolvePeriodKey, today } from "@/lib/period";

export const Route = createFileRoute("/")({
  loaderDeps: ({ search }) => ({ period: search.period, compare: search.compare }),
  loader: async ({ context, deps }) => {
    const settings = await context.queryClient.ensureQueryData(settingsQueryOptions());
    const period = resolvePeriodKey(deps.period, settings.timezone);
    await Promise.all([
      context.queryClient.ensureQueryData(
        periodFlowQuery(flowInput(period, deps.compare, settings.reportingCurrency)),
      ),
      context.queryClient.ensureQueryData(
        questionSummaryQuery({
          currency: settings.reportingCurrency,
          period: periodSelection(period),
        }),
      ),
    ]);
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
  const { data: questions } = useSuspenseQuery(
    questionSummaryQuery({ currency: settings.reportingCurrency, period: periodSelection(period) }),
  );
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

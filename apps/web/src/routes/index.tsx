import type { YearMonth } from "@repo/contracts/finance";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { NoRecords } from "@/components/no-records";
import { BriefingSection } from "@/features/analyst/briefing";
import { monthlyFlowQuery, periodFlowQuery } from "@/features/flow/queries";
import { importsQueryOptions } from "@/features/imports/queries";
import { modelSettingsQuery } from "@/features/models/queries";
import { FirstUse } from "@/features/overview/first-use";
import { OverviewPage } from "@/features/overview/page";
import { questionSummaryQuery } from "@/features/questions/queries";
import { settingsQueryOptions } from "@/features/settings/queries";
import {
  endedMonth,
  flowInput,
  type PeriodChoice,
  periodRecords,
  periodSelection,
  resolvePeriodKey,
  today,
} from "@/lib/period";

export const Route = createFileRoute("/")({
  loaderDeps: ({ search }) => ({ period: search.period, compare: search.compare }),
  loader: async ({ context: { queryClient }, deps }) => {
    const settings = await queryClient.ensureQueryData(settingsQueryOptions());
    const months = await queryClient.ensureQueryData(monthlyFlowQuery(settings.reportingCurrency));
    const period = resolvePeriodKey(deps.period, settings.timezone);
    const records = periodRecords(months, period);
    if (records === "none") await queryClient.ensureInfiniteQueryData(importsQueryOptions());
    if (records === "recorded")
      await Promise.all([
        queryClient.ensureQueryData(
          periodFlowQuery(flowInput(period, deps.compare, settings.reportingCurrency)),
        ),
        queryClient.ensureQueryData(
          questionSummaryQuery({
            currency: settings.reportingCurrency,
            period: periodSelection(period),
          }),
        ),
        // Whether the analyst is on decides whether the month's briefing has a section.
        endedMonth(period, settings.timezone) && queryClient.ensureQueryData(modelSettingsQuery()),
      ]);
  },
  component: Overview,
});

function Overview() {
  const search = Route.useSearch();
  const { data: settings } = useSuspenseQuery(settingsQueryOptions());
  const { data: months } = useSuspenseQuery(monthlyFlowQuery(settings.reportingCurrency));
  const period = resolvePeriodKey(search.period, settings.timezone);
  const records = periodRecords(months, period);
  switch (records) {
    case "none":
      return <FirstUse timezone={settings.timezone} />;
    case "missing":
      return (
        <div className="space-y-6">
          <h1 className="type-title">{period.label}</h1>
          <NoRecords records={records} period={period} timezone={settings.timezone} />
        </div>
      );
    case "recorded":
      return <RecordedOverview period={period} firstMonth={months[0]?.month ?? period.from} />;
  }
}

function RecordedOverview({ period, firstMonth }: { period: PeriodChoice; firstMonth: YearMonth }) {
  const { compare } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data: settings } = useSuspenseQuery(settingsQueryOptions());
  const { data: flow } = useSuspenseQuery(
    periodFlowQuery(flowInput(period, compare, settings.reportingCurrency)),
  );
  const { data: questions } = useSuspenseQuery(
    questionSummaryQuery({ currency: settings.reportingCurrency, period: periodSelection(period) }),
  );
  const month = endedMonth(period, settings.timezone);
  return (
    <OverviewPage
      flow={flow}
      period={period}
      compare={compare}
      onCompare={(next) => {
        navigate({ search: (previous) => ({ ...previous, compare: next }) }).catch(reportError);
      }}
      firstMonth={firstMonth}
      today={today(settings.timezone)}
      questions={questions}
      briefing={month && <BriefingSection month={month} />}
    />
  );
}

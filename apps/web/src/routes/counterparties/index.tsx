import { FlowDirection, ListCounterparties, type MonthlyFlow } from "@repo/contracts/finance";
import { monthsPeriod } from "@repo/finance";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Schema } from "effect";

import { NoRecords } from "@/components/no-records";
import { CounterpartiesPage } from "@/features/counterparties/list";
import { counterpartiesQuery } from "@/features/counterparties/queries";
import { referenceDataQuery } from "@/features/events/queries";
import { monthlyFlowQuery } from "@/features/flow/queries";
import { settingsQueryOptions } from "@/features/settings/queries";
import { type PeriodChoice, periodMonths, periodRecords, resolvePeriodKey } from "@/lib/period";

const Search = Schema.Struct({
  search: Schema.optional(ListCounterparties.fields.search),
  direction: Schema.optional(FlowDirection),
});

export const Route = createFileRoute("/counterparties/")({
  validateSearch: Schema.toStandardSchemaV1(Search),
  loaderDeps: ({ search }) => ({
    period: search.period,
    search: search.search ?? "",
    direction: search.direction ?? "out",
  }),
  loader: async ({ context, deps }) => {
    const settings = await context.queryClient.ensureQueryData(settingsQueryOptions());
    const months = await context.queryClient.ensureQueryData(
      monthlyFlowQuery(settings.reportingCurrency),
    );
    const period = resolvePeriodKey(deps.period, settings.timezone);
    if (periodRecords(months, period) !== "recorded") return;
    await Promise.all([
      context.queryClient.ensureQueryData(
        counterpartiesQuery({
          search: deps.search,
          currency: settings.reportingCurrency,
          period: monthsPeriod(period.from, period.to),
          direction: deps.direction,
        }),
      ),
      context.queryClient.ensureQueryData(referenceDataQuery()),
    ]);
  },
  component: Counterparties,
});

function Counterparties() {
  const { period: key } = Route.useSearch();
  const { data: settings } = useSuspenseQuery(settingsQueryOptions());
  const { data: months } = useSuspenseQuery(monthlyFlowQuery(settings.reportingCurrency));
  const period = resolvePeriodKey(key, settings.timezone);
  const records = periodRecords(months, period);
  return records === "recorded" ? (
    <RecordedCounterparties period={period} months={periodMonths(months, period)} />
  ) : (
    <div className="space-y-6">
      <h1 className="type-title">Counterparties</h1>
      <NoRecords records={records} period={period} timezone={settings.timezone} />
    </div>
  );
}

function RecordedCounterparties({
  period,
  months,
}: {
  period: PeriodChoice;
  months: typeof MonthlyFlow.Type;
}) {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data: settings } = useSuspenseQuery(settingsQueryOptions());
  const direction = search.direction ?? "out";
  const { data: counterparties } = useSuspenseQuery(
    counterpartiesQuery({
      search: search.search ?? "",
      currency: settings.reportingCurrency,
      period: monthsPeriod(period.from, period.to),
      direction,
    }),
  );
  const { data: references } = useSuspenseQuery(referenceDataQuery());
  return (
    <CounterpartiesPage
      counterparties={counterparties}
      references={references}
      period={period}
      direction={direction}
      moneyMoved={months.some(
        (month) => (direction === "out" ? month.outflow : month.inflow).minor !== 0n,
      )}
      search={search.search ?? ""}
      onSearch={(value) => {
        navigate({ search: (previous) => ({ ...previous, search: value || undefined }) }).catch(
          reportError,
        );
      }}
      onDirection={(value) => {
        navigate({
          search: (previous) => ({ ...previous, direction: value === "out" ? undefined : value }),
        }).catch(reportError);
      }}
    />
  );
}

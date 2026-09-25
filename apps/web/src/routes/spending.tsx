import { CategoryId } from "@repo/contracts/finance";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Schema } from "effect";

import { referenceDataQuery } from "@/features/events/queries";
import { monthlyFlowQuery, spendingQuery } from "@/features/flow/queries";
import { settingsQueryOptions } from "@/features/settings/queries";
import { SpendingPage } from "@/features/spending/page";
import { flowInput, resolvePeriodKey, today } from "@/lib/period";

const Search = Schema.Struct({ category: Schema.optional(CategoryId) });

export const Route = createFileRoute("/spending")({
  validateSearch: Schema.toStandardSchemaV1(Search),
  loaderDeps: ({ search }) => ({
    period: search.period,
    compare: search.compare,
    category: search.category,
  }),
  loader: async ({ context, deps }) => {
    const settings = await context.queryClient.ensureQueryData(settingsQueryOptions());
    await Promise.all([
      context.queryClient.ensureQueryData(
        spendingQuery({
          ...flowInput(
            resolvePeriodKey(deps.period, settings.timezone),
            deps.compare,
            settings.reportingCurrency,
          ),
          categoryId: deps.category ?? null,
        }),
      ),
      context.queryClient.ensureQueryData(referenceDataQuery()),
    ]);
  },
  component: Spending,
});

function Spending() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data: settings } = useSuspenseQuery(settingsQueryOptions());
  const period = resolvePeriodKey(search.period, settings.timezone);
  const { data: breakdown } = useSuspenseQuery(
    spendingQuery({
      ...flowInput(period, search.compare, settings.reportingCurrency),
      categoryId: search.category ?? null,
    }),
  );
  const { data: references } = useSuspenseQuery(referenceDataQuery());
  const parents = new Set<string>(
    references.categories.flatMap((category) => (category.parentId ? [category.parentId] : [])),
  );
  const { data: months } = useSuspenseQuery(monthlyFlowQuery(settings.reportingCurrency));
  const coverage = new Map(months.map((month) => [month.month, month.coverage]));
  return (
    <SpendingPage
      breakdown={breakdown}
      period={period}
      compare={search.compare}
      onCompare={(compare) => {
        navigate({ search: (previous) => ({ ...previous, compare }) }).catch(reportError);
      }}
      firstMonth={months[0]?.month ?? period.from}
      today={today(settings.timezone)}
      parents={parents}
      coverage={coverage}
    />
  );
}

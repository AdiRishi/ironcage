import { monthsPeriod } from "@repo/finance";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Schema } from "effect";

import { CounterpartiesPage } from "@/features/counterparties/list";
import { counterpartiesQuery } from "@/features/counterparties/queries";
import { referenceDataQuery } from "@/features/events/queries";
import { settingsQueryOptions } from "@/features/settings/queries";
import { resolvePeriodKey } from "@/lib/period";

const Search = Schema.Struct({
  search: Schema.optional(Schema.String.check(Schema.isMaxLength(100))),
  direction: Schema.optional(Schema.Literals(["out", "in"])),
});

export const Route = createFileRoute("/counterparties/")({
  validateSearch: Schema.toStandardSchemaV1(Search),
  loaderDeps: ({ search }) => ({ period: search.period, search: search.search ?? "" }),
  loader: async ({ context, deps }) => {
    const settings = await context.queryClient.ensureQueryData(settingsQueryOptions());
    const period = resolvePeriodKey(deps.period, settings.timezone);
    await Promise.all([
      context.queryClient.ensureQueryData(
        counterpartiesQuery({
          search: deps.search,
          currency: settings.reportingCurrency,
          period: monthsPeriod(period.from, period.to),
        }),
      ),
      context.queryClient.ensureQueryData(referenceDataQuery()),
    ]);
  },
  component: Counterparties,
});

function Counterparties() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data: settings } = useSuspenseQuery(settingsQueryOptions());
  const period = resolvePeriodKey(search.period, settings.timezone);
  const { data: counterparties } = useSuspenseQuery(
    counterpartiesQuery({
      search: search.search ?? "",
      currency: settings.reportingCurrency,
      period: monthsPeriod(period.from, period.to),
    }),
  );
  const { data: references } = useSuspenseQuery(referenceDataQuery());
  return (
    <CounterpartiesPage
      counterparties={counterparties}
      references={references}
      period={period}
      direction={search.direction ?? "out"}
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

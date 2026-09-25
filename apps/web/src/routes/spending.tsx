import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Schema } from "effect";

import { referenceDataQuery } from "@/features/events/queries";
import { monthlyFlowQuery } from "@/features/flow/queries";
import { countedLedgerPagesQuery } from "@/features/ledger/queries";
import { settingsQueryOptions } from "@/features/settings/queries";
import { SpendingPage } from "@/features/spending/page";
import { spendingQuery } from "@/features/spending/queries";
import {
  narrowingOf,
  SpendingSearch,
  spendingInput,
  transactionsInput,
} from "@/features/spending/search";
import { resolvePeriodKey, today } from "@/lib/period";

export const Route = createFileRoute("/spending")({
  validateSearch: Schema.toStandardSchemaV1(SpendingSearch),
  // The period, the comparison, and every part of the scope.
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps: { period: key, compare, ...search } }) => {
    const settings = await context.queryClient.ensureQueryData(settingsQueryOptions());
    const period = resolvePeriodKey(key, settings.timezone);
    const [breakdown] = await Promise.all([
      context.queryClient.ensureQueryData(
        spendingQuery(spendingInput(search, period, compare, settings.reportingCurrency)),
      ),
      search.tag || search.personalEvent
        ? context.queryClient.ensureQueryData(referenceDataQuery())
        : null,
    ]);
    if (breakdown.level === "transactions")
      await context.queryClient.ensureInfiniteQueryData(
        countedLedgerPagesQuery(transactionsInput(search, period, settings.reportingCurrency)),
      );
  },
  component: Spending,
});

function Spending() {
  const { period: key, compare, ...search } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data: settings } = useSuspenseQuery(settingsQueryOptions());
  const period = resolvePeriodKey(key, settings.timezone);
  const { data: breakdown } = useSuspenseQuery(
    spendingQuery(spendingInput(search, period, compare, settings.reportingCurrency)),
  );
  const { data: months } = useSuspenseQuery(monthlyFlowQuery(settings.reportingCurrency));
  return (
    <SpendingPage
      breakdown={breakdown}
      transactions={transactionsInput(search, period, settings.reportingCurrency)}
      period={period}
      compare={compare}
      onCompare={(next) => {
        navigate({ search: (previous) => ({ ...previous, compare: next }) }).catch(reportError);
      }}
      firstMonth={months[0]?.month ?? period.from}
      today={today(settings.timezone)}
      narrowing={narrowingOf(search)}
    />
  );
}

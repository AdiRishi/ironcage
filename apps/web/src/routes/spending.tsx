import type { YearMonth } from "@repo/contracts/finance";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Schema } from "effect";

import { NoRecords } from "@/components/no-records";
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
import { addressNotFound } from "@/lib/address";
import { type PeriodChoice, periodRecords, resolvePeriodKey, today } from "@/lib/period";

export const Route = createFileRoute("/spending")({
  validateSearch: Schema.toStandardSchemaV1(SpendingSearch),
  onError: addressNotFound,
  // The period, the comparison, and every part of the scope.
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps: { period: key, compare, ...search } }) => {
    const settings = await context.queryClient.ensureQueryData(settingsQueryOptions());
    const months = await context.queryClient.ensureQueryData(
      monthlyFlowQuery(settings.reportingCurrency),
    );
    const period = resolvePeriodKey(key, settings.timezone);
    if (periodRecords(months, period) !== "recorded") return;
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
  const { period: key } = Route.useSearch();
  const { data: settings } = useSuspenseQuery(settingsQueryOptions());
  const { data: months } = useSuspenseQuery(monthlyFlowQuery(settings.reportingCurrency));
  const period = resolvePeriodKey(key, settings.timezone);
  const records = periodRecords(months, period);
  return records === "recorded" ? (
    <RecordedSpending period={period} firstMonth={months[0]?.month ?? period.from} />
  ) : (
    <div className="space-y-6">
      <h1 className="type-title">Spending in {period.label}</h1>
      <NoRecords records={records} period={period} timezone={settings.timezone} />
    </div>
  );
}

function RecordedSpending({ period, firstMonth }: { period: PeriodChoice; firstMonth: YearMonth }) {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data: settings } = useSuspenseQuery(settingsQueryOptions());
  const { data: breakdown } = useSuspenseQuery(
    spendingQuery(spendingInput(search, period, search.compare, settings.reportingCurrency)),
  );
  return (
    <SpendingPage
      breakdown={breakdown}
      transactions={transactionsInput(search, period, settings.reportingCurrency)}
      period={period}
      compare={search.compare}
      onCompare={(next) => {
        navigate({ search: (previous) => ({ ...previous, compare: next }) }).catch(reportError);
      }}
      firstMonth={firstMonth}
      today={today(settings.timezone)}
      narrowing={narrowingOf(search)}
    />
  );
}

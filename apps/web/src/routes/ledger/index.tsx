import type { Account } from "@repo/contracts/finance";
import { measures } from "@repo/finance";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Schema } from "effect";

import { NoRecords } from "@/components/no-records";
import { accountsQueryOptions } from "@/features/accounts/queries";
import { monthlyFlowQuery } from "@/features/flow/queries";
import { CountedLedgerPage, LedgerPage } from "@/features/ledger/page";
import { countedLedgerQuery, ledgerQuery } from "@/features/ledger/queries";
import {
  type CountedSearch,
  countedLedgerInput,
  LedgerSearch,
  ledgerInput,
  type PostingSearch,
} from "@/features/ledger/search";
import { settingsQueryOptions } from "@/features/settings/queries";
import {
  type PeriodChoice,
  type PeriodRecords,
  periodRecords,
  resolvePeriodKey,
} from "@/lib/period";

export const Route = createFileRoute("/ledger/")({
  validateSearch: Schema.toStandardSchemaV1(LedgerSearch),
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps: search }) => {
    const settings = await context.queryClient.ensureQueryData(settingsQueryOptions());
    const months = await context.queryClient.ensureQueryData(
      monthlyFlowQuery(settings.reportingCurrency),
    );
    const period = resolvePeriodKey(search.period, settings.timezone);
    // A number's records are read only for a period with records. The posting ledger is
    // read either way, because your own dates or one file can set its days.
    await Promise.all([
      search.measure
        ? periodRecords(months, period) === "recorded"
          ? context.queryClient.ensureQueryData(
              countedLedgerQuery(countedLedgerInput(search, period, settings.reportingCurrency)),
            )
          : null
        : context.queryClient.ensureQueryData(ledgerQuery(ledgerInput(search, period))),
      context.queryClient.ensureQueryData(accountsQueryOptions()),
    ]);
  },
  component: Ledger,
});

function Ledger() {
  const search = Route.useSearch();
  const { data: settings } = useSuspenseQuery(settingsQueryOptions());
  const period = resolvePeriodKey(search.period, settings.timezone);
  const { data: months } = useSuspenseQuery(monthlyFlowQuery(settings.reportingCurrency));
  const { data: accounts } = useSuspenseQuery(accountsQueryOptions());
  const navigate = Route.useNavigate();
  const records = periodRecords(months, period);
  const view = {
    period,
    accounts,
    navigate: (next: LedgerSearch) => {
      navigate({ search: next }).catch(reportError);
    },
  };
  if (!search.measure)
    return (
      <PostingLedger {...view} search={search} records={records} timezone={settings.timezone} />
    );
  return records === "recorded" ? (
    <CountedLedger {...view} search={search} currency={settings.reportingCurrency} />
  ) : (
    <div className="space-y-6">
      <h1 className="type-title">
        {measures[search.measure].label} in {period.label}
      </h1>
      <NoRecords records={records} period={period} timezone={settings.timezone} />
    </div>
  );
}

type View = {
  period: PeriodChoice;
  accounts: readonly Account[];
  navigate: (search: LedgerSearch) => void;
};

function PostingLedger({
  search,
  ...view
}: View & { search: PostingSearch; records: PeriodRecords; timezone: string }) {
  const { data: page } = useSuspenseQuery(ledgerQuery(ledgerInput(search, view.period)));
  return <LedgerPage {...view} search={search} page={page} />;
}

function CountedLedger({
  search,
  currency,
  ...view
}: View & { search: CountedSearch; currency: string }) {
  const { data: page } = useSuspenseQuery(
    countedLedgerQuery(countedLedgerInput(search, view.period, currency)),
  );
  return <CountedLedgerPage {...view} search={search} page={page} />;
}

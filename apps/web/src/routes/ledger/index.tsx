import type { Account } from "@repo/contracts/finance";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Schema } from "effect";

import { accountsQueryOptions } from "@/features/accounts/queries";
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
import { type PeriodChoice, resolvePeriodKey } from "@/lib/period";

export const Route = createFileRoute("/ledger/")({
  validateSearch: Schema.toStandardSchemaV1(LedgerSearch),
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps: search }) => {
    const settings = await context.queryClient.ensureQueryData(settingsQueryOptions());
    const period = resolvePeriodKey(search.period, settings.timezone);
    await Promise.all([
      search.measure
        ? context.queryClient.ensureQueryData(
            countedLedgerQuery(countedLedgerInput(search, period, settings.reportingCurrency)),
          )
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
  const { data: accounts } = useSuspenseQuery(accountsQueryOptions());
  const navigate = Route.useNavigate();
  const view = {
    period,
    accounts,
    navigate: (next: LedgerSearch) => {
      navigate({ search: next }).catch(reportError);
    },
  };
  return search.measure ? (
    <CountedLedger {...view} search={search} currency={settings.reportingCurrency} />
  ) : (
    <PostingLedger {...view} search={search} />
  );
}

type View = {
  period: PeriodChoice;
  accounts: readonly Account[];
  navigate: (search: LedgerSearch) => void;
};

function PostingLedger({ search, ...view }: View & { search: PostingSearch }) {
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

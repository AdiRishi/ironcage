import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Schema } from "effect";

import { accountsQueryOptions } from "@/features/accounts/queries";
import { LedgerPage } from "@/features/ledger/page";
import { ledgerQuery } from "@/features/ledger/queries";
import { LedgerSearch, ledgerInput } from "@/features/ledger/search";
import { resolvePeriodKey } from "@/lib/period";

export const Route = createFileRoute("/ledger/")({
  validateSearch: Schema.toStandardSchemaV1(LedgerSearch),
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps: { period, ...search } }) =>
    Promise.all([
      context.queryClient.ensureQueryData(
        ledgerQuery(ledgerInput(search, resolvePeriodKey(period))),
      ),
      context.queryClient.ensureQueryData(accountsQueryOptions()),
    ]),
  component: Ledger,
});

function Ledger() {
  const { period: key, ...search } = Route.useSearch();
  const period = resolvePeriodKey(key);
  const navigate = Route.useNavigate();
  const { data: page } = useSuspenseQuery(ledgerQuery(ledgerInput(search, period)));
  const { data: accounts } = useSuspenseQuery(accountsQueryOptions());
  return (
    <LedgerPage
      search={search}
      period={period}
      page={page}
      accounts={accounts}
      navigate={(next) => {
        navigate({ search: { ...next, period: key } }).catch(reportError);
      }}
    />
  );
}

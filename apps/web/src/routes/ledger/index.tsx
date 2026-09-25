import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Schema, Struct } from "effect";

import { accountsQueryOptions } from "@/features/accounts/queries";
import { LedgerPage } from "@/features/ledger/page";
import { ledgerQuery } from "@/features/ledger/queries";
import { LedgerSearch, ledgerInput } from "@/features/ledger/search";
import { settingsQueryOptions } from "@/features/settings/queries";
import { resolvePeriodKey } from "@/lib/period";

export const Route = createFileRoute("/ledger/")({
  validateSearch: Schema.toStandardSchemaV1(LedgerSearch),
  loaderDeps: ({ search }) => Struct.omit(search, ["compare"]),
  loader: async ({ context, deps: { period, ...search } }) => {
    const settings = await context.queryClient.ensureQueryData(settingsQueryOptions());
    await Promise.all([
      context.queryClient.ensureQueryData(
        ledgerQuery(ledgerInput(search, resolvePeriodKey(period, settings.timezone))),
      ),
      context.queryClient.ensureQueryData(accountsQueryOptions()),
    ]);
  },
  component: Ledger,
});

function Ledger() {
  const { period: key, ...search } = Struct.omit(Route.useSearch(), ["compare"]);
  const { data: settings } = useSuspenseQuery(settingsQueryOptions());
  const period = resolvePeriodKey(key, settings.timezone);
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

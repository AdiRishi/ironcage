import { OverviewInput } from "@repo/contracts/finance";
import { createFileRoute } from "@tanstack/react-router";
import { Schema } from "effect";

import { accountsQueryOptions } from "@/features/accounts/queries";
import { OverviewPage } from "@/features/analysis/overview";
import { overviewQuery } from "@/features/analysis/queries";
import { defaultOverview } from "@/features/analysis/selection";
const Search = Schema.Struct({ query: Schema.optionalKey(OverviewInput) });
export const Route = createFileRoute("/overview")({
  validateSearch: Schema.toStandardSchemaV1(Search),
  loaderDeps: ({ search }) => search.query ?? defaultOverview,
  loader: ({ context, deps }) =>
    Promise.all([
      context.queryClient.fetchQuery(overviewQuery(deps)),
      context.queryClient.ensureQueryData(accountsQueryOptions()),
    ]),
  pendingComponent: () => <output>Calculating overview…</output>,
  component: Page,
});
function Page() {
  const input = Route.useSearch().query ?? defaultOverview;
  const navigate = Route.useNavigate();
  return <OverviewPage input={input} onApply={(query) => navigate({ search: { query } })} />;
}

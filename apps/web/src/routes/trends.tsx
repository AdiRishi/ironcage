import { createFileRoute } from "@tanstack/react-router";
import { Schema } from "effect";

import { accountsQueryOptions } from "@/features/accounts/queries";
import { contributorsQuery } from "@/features/analysis/queries";
import { AnalysisSearch, analysisInput } from "@/features/analysis/search";
import { TrendsPage } from "@/features/analysis/trends";
import { referenceDataQuery } from "@/features/events/queries";
export const Route = createFileRoute("/trends")({
  validateSearch: Schema.toStandardSchemaV1(AnalysisSearch),
  loaderDeps: ({ search }) => analysisInput(search),
  loader: ({ context, deps }) =>
    Promise.all([
      context.queryClient.fetchQuery(contributorsQuery(deps)),
      context.queryClient.ensureQueryData(accountsQueryOptions()),
      context.queryClient.ensureQueryData(referenceDataQuery()),
    ]),
  pendingComponent: () => <output>Calculating comparison…</output>,
  component: Page,
});
function Page() {
  const input = analysisInput(Route.useSearch());
  const navigate = Route.useNavigate();
  return (
    <TrendsPage
      {...input}
      onChange={(query, groupBy) => navigate({ search: { query, groupBy } })}
    />
  );
}

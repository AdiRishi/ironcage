import { AnalysisRowsInput } from "@repo/contracts/finance";
import { createFileRoute } from "@tanstack/react-router";
import { Schema } from "effect";

import { analysisRowsQuery } from "@/features/analysis/queries";
import { AnalysisRowsPage } from "@/features/analysis/rows";
export const Route = createFileRoute("/trends_/rows")({
  validateSearch: Schema.toStandardSchemaV1(AnalysisRowsInput),
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => context.queryClient.fetchQuery(analysisRowsQuery(deps)),
  pendingComponent: () => <output>Reading contributors…</output>,
  component: Page,
});
function Page() {
  const navigate = Route.useNavigate();
  return <AnalysisRowsPage input={Route.useSearch()} onPage={(search) => navigate({ search })} />;
}

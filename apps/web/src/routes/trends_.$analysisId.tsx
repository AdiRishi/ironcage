import { AnalysisId } from "@repo/contracts/finance";
import { createFileRoute } from "@tanstack/react-router";

import { SavedAnalysisPage } from "@/features/analysis/saved-page";
import { savedResultQuery } from "@/features/analysis/saved-queries";

export const Route = createFileRoute("/trends_/$analysisId")({
  params: {
    parse: ({ analysisId }) => ({ analysisId: AnalysisId.make(analysisId) }),
  },
  loader: ({ context, params }) =>
    context.queryClient.fetchQuery({
      ...savedResultQuery({ id: params.analysisId }),
      staleTime: 0,
    }),
  pendingComponent: () => <output>Calculating saved analysis…</output>,
  component: Page,
});
function Page() {
  const { analysisId } = Route.useParams();
  return <SavedAnalysisPage input={{ id: analysisId }} />;
}

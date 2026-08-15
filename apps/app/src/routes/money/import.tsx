import { Skeleton } from "@ironcage/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { CoveragePanel } from "@/features/money/components/coverage-panel";
import { EvidenceLine } from "@/features/money/components/evidence-line";
import { ImportHistory } from "@/features/money/components/import-history";
import { ImportWizard } from "@/features/money/components/import-wizard";
import { accountsQuery, coverageQuery, historyQuery } from "@/features/money/queries";

export const Route = createFileRoute("/money/import")({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(accountsQuery),
      context.queryClient.ensureQueryData(coverageQuery),
      context.queryClient.ensureQueryData(historyQuery),
    ]),
  component: MoneyImport,
});

function MoneyImport() {
  const coverage = useQuery(coverageQuery);
  const history = useQuery(historyQuery);

  return (
    <div className="flex flex-col gap-6">
      <EvidenceLine />
      <ImportWizard />
      {coverage.isPending ? (
        <Skeleton className="h-48 w-full rounded-xl" />
      ) : coverage.isError ? (
        <p className="text-sm text-destructive">Coverage unavailable — {String(coverage.error)}</p>
      ) : (
        <CoveragePanel coverage={coverage.data} />
      )}
      {history.isPending ? (
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : history.isError ? (
        <p className="text-sm text-destructive">History unavailable — {String(history.error)}</p>
      ) : (
        <ImportHistory entries={history.data} />
      )}
    </div>
  );
}

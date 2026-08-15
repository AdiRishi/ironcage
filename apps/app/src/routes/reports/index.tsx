import { Skeleton } from "@ironcage/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { ReportLibrary as Library } from "@/features/reports/components/report-library";
import { reportsQuery } from "@/features/reports/queries";

export const Route = createFileRoute("/reports/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(reportsQuery),
  component: ReportLibrary,
});

function ReportLibrary() {
  const reports = useQuery(reportsQuery);
  if (reports.isPending) return <Skeleton className="h-72 w-full rounded-xl" />;
  if (reports.isError)
    return (
      <p className="text-sm text-destructive">Reports unavailable — {String(reports.error)}</p>
    );
  return <Library reports={reports.data} />;
}

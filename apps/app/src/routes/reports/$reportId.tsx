import { ReportId } from "@ironcage/domain";
import { Skeleton } from "@ironcage/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Schema } from "effect";

import { MonthlySpendingReportView } from "@/features/reports/components/monthly-spending-report";
import { reportQuery } from "@/features/reports/queries";

const decodeReportId = Schema.decodeUnknownSync(ReportId);

export const Route = createFileRoute("/reports/$reportId")({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(reportQuery(decodeReportId(params.reportId))),
  component: ReportDetail,
});

function ReportDetail() {
  const { reportId } = Route.useParams();
  const report = useQuery(reportQuery(decodeReportId(reportId)));
  if (report.isPending) return <Skeleton className="h-96 w-full rounded-xl" />;
  if (report.isError)
    return <p className="text-sm text-destructive">Report unavailable — {String(report.error)}</p>;
  return <MonthlySpendingReportView report={report.data} />;
}

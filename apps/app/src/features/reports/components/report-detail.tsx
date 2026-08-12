import { formatFullDay, formatMonth, MonthlySpendingReport, type ReportId } from "@ironcage/domain";
import { Button } from "@ironcage/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect } from "react";

import { CallFailure, Panel, PanelSkeleton } from "@/components/common/panels";
import { unwrap } from "@/data/core-call";
import { keys } from "@/data/keys";
import { reportQuery } from "@/features/reports/queries";
import { newRequestId } from "@/lib/request-id";
import { markMonthlySpendingReportRead } from "@/server/money";

export function ReportDetail({ reportId }: { readonly reportId: ReportId }) {
  const queryClient = useQueryClient();
  const rendered = useQuery(reportQuery(reportId));
  const markRead = useMutation({
    mutationFn: async () =>
      unwrap(MonthlySpendingReport)(
        await markMonthlySpendingReportRead({ data: { id: reportId, requestId: newRequestId() } }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.reports() }),
  });

  // Opening a report is what reads it. The mutation is idempotent on the stored
  // read time, so a re-render or a retry cannot move the moment it was first read.
  const unread = rendered.data?.report.readAt === null;
  const { mutate: recordRead } = markRead;

  useEffect(() => {
    if (unread) recordRead();
  }, [unread, recordRead]);

  if (rendered.isPending) return <PanelSkeleton rows={8} />;
  if (rendered.isError) return <CallFailure error={rendered.error} />;

  const { report, html } = rendered.data;

  return (
    <div className="flex flex-col gap-7">
      <Panel
        title={`Spending report · ${formatMonth(report.month)}`}
        // A Link renders an anchor, so Base UI has to be told not to expect a native button.
        action={
          <Button variant="ghost" size="sm" nativeButton={false} render={<Link to="/reports" />}>
            All reports
          </Button>
        }
      >
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-xl border bg-card p-4 text-xs text-muted-foreground">
          <span>data through {formatFullDay(report.dataThrough)}</span>
          <span>{report.supportingTransactionIds.length} supporting transactions</span>
          <span>{report.recurringCharges.length} recurring charges</span>
          <span>{report.anomalies.length} anomalies</span>
        </div>
      </Panel>

      {/*
        The report body is a complete document core rendered and stored, with its
        own stylesheet. It is shown in a sandboxed frame so its styles cannot
        reach the app's and its markup cannot run script here.
      */}
      <iframe
        title={`Spending report for ${formatMonth(report.month)}`}
        srcDoc={html}
        sandbox=""
        className="h-[1400px] w-full rounded-xl border bg-card"
      />
    </div>
  );
}

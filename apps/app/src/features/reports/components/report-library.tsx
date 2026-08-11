import {
  CalendarMonth,
  formatAud,
  formatFullDay,
  formatMonth,
  MonthlySpendingReport,
} from "@ironcage/domain";
import { Badge } from "@ironcage/ui/components/badge";
import { Button } from "@ironcage/ui/components/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@ironcage/ui/components/empty";
import { Label } from "@ironcage/ui/components/label";
import { Spinner } from "@ironcage/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Schema } from "effect";
import { useState } from "react";

import { CallFailure, Panel, PanelSkeleton } from "@/components/common/panels";
import { unwrap } from "@/data/core-call";
import { keys } from "@/data/keys";
import { reportsQuery } from "@/features/reports/queries";
import { newRequestId } from "@/lib/request-id";
import { generateMonthlySpendingReport } from "@/server/money";

const decodeMonth = Schema.decodeUnknownSync(CalendarMonth);

/** The month a report is normally asked for: the last one that can be complete. */
const previousMonth = () => {
  const now = new Date();

  return decodeMonth(
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7),
  );
};

export function ReportLibrary() {
  const reports = useQuery(reportsQuery);

  return (
    <div className="flex flex-col gap-7">
      <GenerateReport />

      <Panel title="Monthly spending reports">
        {reports.isPending ? (
          <PanelSkeleton rows={4} />
        ) : reports.isError ? (
          <CallFailure error={reports.error} />
        ) : reports.data.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyTitle>No report has been generated</EmptyTitle>
              <EmptyDescription>
                A report is generated for one complete month. Import every required account's window
                for a month, then ask for it above.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="flex flex-col gap-3">
            {reports.data.map((report) => (
              <ReportRow key={report.id} report={report} />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function ReportRow({ report }: { readonly report: MonthlySpendingReport }) {
  return (
    <li>
      <Link
        to="/reports/$reportId"
        params={{ reportId: report.id }}
        className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card p-4 hover:bg-row-hover"
      >
        <div className="flex flex-col gap-1">
          <span className="flex items-center gap-2 font-display text-base">
            {formatMonth(report.month)}
            {report.readAt === null && (
              <Badge variant="ghost" className="text-live">
                Unread
              </Badge>
            )}
          </span>
          <span className="text-xs text-muted-foreground">
            data through {formatFullDay(report.dataThrough)} ·{" "}
            {report.supportingTransactionIds.length} supporting transactions
          </span>
        </div>
        <div className="flex items-center gap-6 font-mono text-sm tabular-nums">
          <span className="flex flex-col items-end gap-0.5">
            <span className="text-[0.6875rem] tracking-[0.12em] text-muted-foreground uppercase">
              Net spend
            </span>
            {report.analysis.netSpend === null ? "—" : formatAud(report.analysis.netSpend)}
          </span>
          <span className="flex flex-col items-end gap-0.5">
            <span className="text-[0.6875rem] tracking-[0.12em] text-muted-foreground uppercase">
              Income
            </span>
            {report.analysis.income === null ? "—" : formatAud(report.analysis.income)}
          </span>
        </div>
      </Link>
    </li>
  );
}

/**
 * A month is asked for by name rather than picked from a list of eligible ones.
 * Core is what decides eligibility — it refuses an incomplete month and names
 * the account windows still missing — and reproducing that judgement here would
 * give the operator a second opinion that can disagree with the record.
 */
function GenerateReport() {
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(previousMonth);
  const generate = useMutation({
    mutationFn: async (requested: CalendarMonth) =>
      unwrap(MonthlySpendingReport)(
        await generateMonthlySpendingReport({
          data: { month: requested, requestId: newRequestId() },
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.reports() }),
  });

  return (
    <Panel title="Generate a report">
      <div className="flex flex-col gap-4 rounded-xl border bg-card p-5">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="report-month">Month</Label>
            <input
              id="report-month"
              type="month"
              value={month}
              max={previousMonth()}
              onChange={(event) => {
                if (event.target.value !== "") setMonth(decodeMonth(event.target.value));
              }}
              className="h-9 rounded-md border bg-background px-3 font-mono text-sm"
            />
          </div>
          <Button disabled={generate.isPending} onClick={() => generate.mutate(month)}>
            {generate.isPending && <Spinner />}
            Generate {formatMonth(month)}
          </Button>
        </div>

        {generate.isError && <CallFailure error={generate.error} />}
        <p className="text-xs text-muted-foreground">
          A report is only generated for a month every required account covers on every day.
          Regenerating a month returns the report already held rather than writing a second one.
        </p>
      </div>
    </Panel>
  );
}

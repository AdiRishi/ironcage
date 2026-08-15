import type { ReportSummary } from "@ironcage/contracts/schema";
import { Badge } from "@ironcage/ui/components/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@ironcage/ui/components/card";
import { Link } from "@tanstack/react-router";
import { FileTextIcon } from "lucide-react";

import { formatAgo, formatDay } from "@/features/money/format";

export function ReportLibrary({ reports }: { readonly reports: readonly ReportSummary[] }) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-display text-2xl font-semibold">Reports</h2>
        <p className="text-sm text-muted-foreground">
          Permanent snapshots generated from the financial record.
        </p>
      </div>
      {reports.length === 0 ? (
        <Card>
          <CardContent className="items-center py-12 text-center">
            <FileTextIcon className="size-8 text-muted-foreground" />
            <p className="font-medium">No complete-month report yet</p>
            <p className="max-w-lg text-sm text-muted-foreground">
              A monthly spending report appears automatically when every required Money account
              covers the month.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {reports.map((report) => (
            <Link key={report.id} to="/reports/$reportId" params={{ reportId: report.id }}>
              <Card className="h-full transition-colors hover:bg-muted/30">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    {report.title}
                    {report.openedAt === null ? <Badge>Unread</Badge> : null}
                  </CardTitle>
                  <CardDescription>
                    {formatDay(report.periodStart)} – {formatDay(report.periodEnd)}
                  </CardDescription>
                </CardHeader>
                <CardContent className="font-mono text-xs text-muted-foreground">
                  Generated {formatAgo(report.generatedAt)}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

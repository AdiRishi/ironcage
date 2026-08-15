import {
  MarkReportOpenedInput,
  Outcome,
  ReportSummary,
  type MonthlySpendingReport,
} from "@ironcage/contracts/schema";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@ironcage/ui/components/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@ironcage/ui/components/table";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Schema } from "effect";
import { useEffect } from "react";

import { keys } from "@/data/keys";
import { mintRequestId } from "@/data/request";
import { formatAgo, formatAud, formatDay, formatMonth, formatRate } from "@/features/money/format";
import { markReportOpened } from "@/server/reports";

const encodeOpened = Schema.encodeSync(MarkReportOpenedInput);
const decodeOpened = Schema.decodeUnknownSync(Outcome(ReportSummary));

export function MonthlySpendingReportView({ report }: { readonly report: MonthlySpendingReport }) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (report.openedAt !== null) return;
    markReportOpened({
      data: encodeOpened({ requestId: mintRequestId(), reportId: report.id }),
    }).then(
      (encoded) => {
        const outcome = decodeOpened(encoded);
        if (outcome.outcome === "ok") {
          queryClient.invalidateQueries({ queryKey: keys.reports() }).catch(() => undefined);
        }
      },
      () => undefined,
    );
  }, [queryClient, report.id, report.openedAt]);

  return (
    <article className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <header className="flex flex-col gap-1 border-b pb-5">
        <span className="font-mono text-xs tracking-wider text-muted-foreground uppercase">
          Monthly spending report
        </span>
        <h2 className="font-display text-3xl font-semibold">{formatMonth(report.month.month)}</h2>
        <p className="text-sm text-muted-foreground">
          Generated {formatAgo(report.generatedAt)} · data through {formatDay(report.dataThrough)}
        </p>
      </header>
      <div className="grid gap-3 sm:grid-cols-3">
        <Figure label="Income" value={formatAud(report.month.income)} />
        <Figure label="Net spend" value={formatAud(report.month.netSpend)} />
        <Figure
          label="Savings rate"
          value={report.month.savingsRate === null ? "—" : formatRate(report.month.savingsRate)}
        />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Spending by category</CardTitle>
          <CardDescription>Refunds reduce the category they belong to.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.month.categories.map((category) => (
                <TableRow key={category.categoryId}>
                  <TableCell>
                    <Link
                      to="/money/transactions"
                      search={{
                        view: "month",
                        month: report.month.month,
                        category: category.categoryId,
                      }}
                      className="underline-offset-4 hover:underline"
                    >
                      {category.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatAud(category.amount)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Anomalies</CardTitle>
          </CardHeader>
          <CardContent>
            {report.anomalies.length === 0 ? (
              <p className="text-sm text-muted-foreground">No anomaly rules fired.</p>
            ) : (
              report.anomalies.map((anomaly) => (
                <p key={`${anomaly.rule}:${anomaly.subject}`} className="text-sm">
                  <span className="font-medium">{anomaly.subject}</span> — {anomaly.detail}
                </p>
              ))
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Savings suggestions</CardTitle>
          </CardHeader>
          <CardContent>
            {report.suggestions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No supported suggestions in this snapshot.
              </p>
            ) : (
              report.suggestions.map((suggestion) => (
                <p key={`${suggestion.kind}:${suggestion.payee}`} className="text-sm">
                  <span className="font-medium">{suggestion.payee}</span> — {suggestion.detail}
                </p>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </article>
  );
}

function Figure({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <Card size="sm">
      <CardContent>
        <span className="text-xs text-muted-foreground">{label}</span>
        <strong className="font-mono text-xl">{value}</strong>
      </CardContent>
    </Card>
  );
}

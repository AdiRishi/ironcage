import {
  CalendarMonth,
  formatAud,
  formatFullDay,
  formatMonth,
  type SpendingAnomaly,
} from "@ironcage/domain";
import { Badge } from "@ironcage/ui/components/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@ironcage/ui/components/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@ironcage/ui/components/table";
import { useQuery } from "@tanstack/react-query";
import { Schema } from "effect";

import { CallFailure, Panel, PanelSkeleton } from "@/components/common/panels";
import { analysisQuery } from "@/features/money/queries";

const decodeMonth = Schema.decodeUnknownSync(CalendarMonth);

/** Recurrence is a property of a long window, so this reads a year of months. */
const analysisWindow = () => {
  const now = new Date();
  const end = decodeMonth(
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 7),
  );
  const start = decodeMonth(
    new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), 1)).toISOString().slice(0, 7),
  );

  return { start, end };
};

export function RecurringCharges() {
  const window = analysisWindow();
  const analysis = useQuery(analysisQuery(window.start, window.end));

  if (analysis.isPending) return <PanelSkeleton rows={5} />;
  if (analysis.isError) return <CallFailure error={analysis.error} />;

  return (
    <div className="flex flex-col gap-7">
      <Panel title="Recurring charges">
        {analysis.data.recurringCharges.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyTitle>No charge has met the evidence threshold</EmptyTitle>
              <EmptyDescription>
                A charge recurs when it appears at least three times in 400 days, holds its amount
                within 5% of its median, and keeps a steady gap. The window also has to be covered
                for every required account.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Payee</TableHead>
                  <TableHead className="text-right">Typical</TableHead>
                  <TableHead className="text-right">Latest</TableHead>
                  <TableHead className="text-right">Cadence</TableHead>
                  <TableHead className="text-right">A year</TableHead>
                  <TableHead className="text-right">Seen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {analysis.data.recurringCharges.map((charge) => (
                  <TableRow key={charge.payee} className="hover:bg-row-hover">
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <span className="font-medium">{charge.payee}</span>
                        {charge.priceChange !== null && (
                          <Badge variant="ghost" className="self-start text-warning">
                            {formatAud(charge.priceChange.previousAmount)} →{" "}
                            {formatAud(charge.priceChange.currentAmount)}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatAud(charge.typicalAmount)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatAud(charge.latestAmount)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground tabular-nums">
                      {charge.cadenceDays}d
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatAud(charge.estimatedAnnualSpend)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs text-ink-faint tabular-nums">
                      {charge.transactionIds.length}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>

      <Panel title="Anomalies">
        {analysis.data.anomalies.length === 0 ? (
          <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
            No configured anomaly rule fired inside a complete month.
          </p>
        ) : (
          <ul className="overflow-hidden rounded-xl border bg-card">
            {analysis.data.anomalies.map((anomaly) => (
              <li
                key={anomalyKey(anomaly)}
                className="flex items-center justify-between gap-4 border-b border-border/60 p-4 text-sm last:border-0"
              >
                <AnomalyDescription anomaly={anomaly} />
                <Badge variant="ghost" className="whitespace-nowrap text-warning">
                  {anomalyLabel[anomaly._tag]}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Suggestions">
        {analysis.data.suggestions.length === 0 ? (
          <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
            A suggestion needs a complete supporting window. None is available yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {analysis.data.suggestions.map((suggestion) => (
              <li key={suggestion.title} className="rounded-xl border bg-card p-4">
                <p className="font-display text-sm">{suggestion.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{suggestion.reasoning}</p>
                <p className="mt-2 font-mono text-xs text-muted-foreground tabular-nums">
                  {formatAud(suggestion.estimatedAnnualImpact)} a year · data through{" "}
                  {formatFullDay(suggestion.dataThrough)} · {suggestion.transactionIds.length}{" "}
                  transactions
                </p>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

const anomalyLabel = {
  LargeExpense: "Large expense",
  NewPayee: "New payee",
  CategorySpike: "Category spike",
} as const;

const anomalyKey = (anomaly: SpendingAnomaly) =>
  anomaly._tag === "CategorySpike"
    ? `${anomaly._tag}-${anomaly.categoryId}-${anomaly.month}`
    : `${anomaly._tag}-${anomaly.transactionId}`;

function AnomalyDescription({ anomaly }: { readonly anomaly: SpendingAnomaly }) {
  switch (anomaly._tag) {
    case "LargeExpense":
      return (
        <span>
          An expense of {formatAud(anomaly.amount)}, well above this account's recent median.
        </span>
      );
    case "NewPayee":
      return (
        <span>
          First payment to {anomaly.payee} in two years, at {formatAud(anomaly.amount)}.
        </span>
      );
    case "CategorySpike":
      return (
        <span>
          {formatMonth(anomaly.month)} spending reached {formatAud(anomaly.netSpend)} against a{" "}
          {formatAud(anomaly.trailingAverage)} trailing average.
        </span>
      );
  }
}

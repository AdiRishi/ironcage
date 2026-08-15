import type { SavingsSuggestion, SpendingAnomaly } from "@ironcage/contracts/schema";
import { Alert, AlertDescription, AlertTitle } from "@ironcage/ui/components/alert";
import { Badge } from "@ironcage/ui/components/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@ironcage/ui/components/card";
import { InfoIcon } from "lucide-react";

import { formatAud, formatDay, formatMonth } from "@/features/money/format";

const anomalyLabel = {
  large_expense: "Large expense",
  new_payee: "New payee",
  category_spike: "Category spike",
} as const;

export function AnomaliesCard({ anomalies }: { readonly anomalies: readonly SpendingAnomaly[] }) {
  const ordered = [...anomalies].sort((a, b) => b.month.localeCompare(a.month));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-lg tracking-tight">Out of pattern</CardTitle>
        <CardDescription>
          Unusually large transactions, first-time high-value payees, and category spikes.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        {ordered.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing out of pattern on record.</p>
        ) : (
          ordered.map((anomaly) => (
            <div
              key={`${anomaly.rule}:${anomaly.subject}:${anomaly.month}`}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-md px-2 py-2 hover:bg-row-hover"
            >
              <Badge
                variant="outline"
                className="border-warning/60 font-mono text-[10px] text-warning"
              >
                {anomalyLabel[anomaly.rule]}
              </Badge>
              <span className="font-mono text-xs text-muted-foreground">
                {formatMonth(anomaly.month)}
              </span>
              <span className="min-w-0 flex-1 text-sm">{anomaly.detail}</span>
              {anomaly.amount === null ? null : (
                <span className="font-mono text-sm tabular-nums">
                  {formatAud(anomaly.amount, { sign: "none" })}
                </span>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

export function SuggestionsCard({
  suggestions,
  unavailable,
}: {
  readonly suggestions: readonly SavingsSuggestion[];
  readonly unavailable: string | null;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-lg tracking-tight">Worth reconsidering</CardTitle>
        <CardDescription>
          Recommendations only — Money reads your accounts and never moves a dollar.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {unavailable !== null ? (
          <Alert>
            <InfoIcon />
            <AlertTitle>Suggestions are on hold</AlertTitle>
            <AlertDescription>{unavailable}</AlertDescription>
          </Alert>
        ) : suggestions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing to suggest from the record so far.
          </p>
        ) : (
          suggestions.map((suggestion) => (
            <div
              key={`${suggestion.kind}:${suggestion.payee}`}
              className="flex flex-col gap-1 rounded-lg border p-4"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-medium">{suggestion.payee}</span>
                <span className="font-mono text-sm tabular-nums">
                  {formatAud(suggestion.annualAmount, { sign: "none" })} a year
                  {suggestion.kind === "price_rise" ? " in rises alone" : ""}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">{suggestion.detail}</p>
              <span className="font-mono text-xs text-ink-faint">
                from {suggestion.transactionIds.length}{" "}
                {suggestion.transactionIds.length === 1 ? "transaction" : "transactions"} · data
                through {formatDay(suggestion.dataThrough)}
              </span>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

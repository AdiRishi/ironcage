import type { MonthAnalysis } from "@ironcage/contracts/schema";
import { Alert, AlertDescription, AlertTitle } from "@ironcage/ui/components/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@ironcage/ui/components/card";
import { cn } from "@ironcage/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { BigDecimal } from "effect";
import { TriangleAlertIcon } from "lucide-react";

import { formatAud, formatMonth, formatRate } from "@/features/money/format";

function Stat({
  label,
  figure,
  sub,
  subClassName,
}: {
  readonly label: string;
  readonly figure: string;
  readonly sub: string | null;
  readonly subClassName?: string | undefined;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-mono text-[11px] tracking-[0.14em] text-ink-faint uppercase">
        {label}
      </span>
      <span className="font-mono text-2xl text-foreground tabular-nums">{figure}</span>
      {sub === null ? null : (
        <span className={cn("text-xs text-muted-foreground", subClassName)}>{sub}</span>
      )}
    </div>
  );
}

/** How the month's net spend sits against its trailing three-month average. */
function spendComparison(month: MonthAnalysis) {
  if (month.trailingThreeMonthNetSpend === null) {
    return { sub: "needs three complete months to compare", subClassName: undefined };
  }
  const delta = BigDecimal.subtract(month.netSpend, month.trailingThreeMonthNetSpend);
  if (BigDecimal.isZero(delta)) {
    return { sub: "level with the three-month average", subClassName: undefined };
  }
  return BigDecimal.isNegative(delta)
    ? {
        sub: `${formatAud(BigDecimal.abs(delta), { sign: "none" })} under the three-month average`,
        subClassName: "text-live",
      }
    : {
        sub: `${formatAud(delta, { sign: "none" })} over the three-month average`,
        subClassName: "text-warning",
      };
}

export function MonthSummary({ month }: { readonly month: MonthAnalysis }) {
  const comparison = month.complete
    ? spendComparison(month)
    : { sub: "what's known so far", subClassName: undefined };
  const hasIncome = month.savingsRate !== null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-lg tracking-tight">
          {formatMonth(month.month)}
        </CardTitle>
        <CardDescription>
          {month.complete
            ? "Every required account is covered for every day of this month."
            : "A required account has a gap in this month."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {month.complete ? null : (
          <Alert>
            <TriangleAlertIcon className="text-warning" />
            <AlertTitle>Incomplete month</AlertTitle>
            <AlertDescription>
              Totals below show what's on record; comparisons, averages, and reports exclude this
              month until the gap closes. <Link to="/money/import">Close the gap from Import.</Link>
            </AlertDescription>
          </Alert>
        )}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
          <Stat
            label="Income"
            figure={formatAud(month.income, { sign: "none" })}
            sub={hasIncome ? null : "no income recorded"}
          />
          <Stat
            label="Net spend"
            figure={formatAud(month.netSpend, { sign: "none" })}
            sub={comparison.sub}
            subClassName={comparison.subClassName}
          />
          <Stat
            label="Savings rate"
            figure={month.savingsRate === null ? "—" : formatRate(month.savingsRate)}
            sub={month.savingsRate === null ? "undefined without income" : "of income kept"}
          />
        </div>
      </CardContent>
    </Card>
  );
}

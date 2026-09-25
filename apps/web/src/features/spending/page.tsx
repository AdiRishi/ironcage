import type {
  CalendarDate,
  ListCountedLedger,
  SpendingBreakdown,
  YearMonth,
} from "@repo/contracts/finance";
import { periodLabel } from "@repo/finance";

import { categoryColor } from "@/lib/category-colors";
import type { ComparisonKey, PeriodChoice } from "@/lib/period";

import { BreakdownTable } from "./breakdown-table";
import { scopeName, SpendingHeader } from "./header";
import { HistoryChart } from "./history-chart";
import type { Narrowing } from "./search";
import { Transactions } from "./transactions";

// One level of the drill: the open scope's facts and history, then its parts, or at the
// last level the records it counts.
export function SpendingPage({
  breakdown,
  transactions,
  period,
  compare,
  onCompare,
  firstMonth,
  today,
  narrowing,
}: {
  breakdown: SpendingBreakdown;
  // The counted ledger's input for the open scope, read at the transactions level.
  transactions: Omit<typeof ListCountedLedger.Type, "cursor">;
  period: PeriodChoice;
  compare: ComparisonKey | undefined;
  onCompare: (compare: ComparisonKey | undefined) => void;
  firstMonth: YearMonth;
  today: CalendarDate;
  narrowing: Narrowing;
}) {
  const name = scopeName(breakdown);
  return (
    <div className="space-y-10">
      <header className="grid gap-x-12 gap-y-6 lg:grid-cols-[1fr_24rem] lg:items-start">
        <SpendingHeader
          breakdown={breakdown}
          period={period}
          compare={compare}
          onCompare={onCompare}
          firstMonth={firstMonth}
          today={today}
          narrowing={narrowing}
        />
        <HistoryChart
          label={name}
          months={breakdown.months}
          color={
            breakdown.scope.category.kind === "all"
              ? "var(--wattle)"
              : categoryColor(breakdown.slug)
          }
          period={period}
        />
      </header>

      {breakdown.level === "transactions" ? (
        <section aria-label="Transactions">
          <Transactions input={transactions} periodLabel={period.label} />
        </section>
      ) : (
        <section aria-labelledby="rows-heading" className="space-y-3">
          <h2 id="rows-heading" className="sr-only">
            Within {name}
          </h2>
          {breakdown.rows.length === 0 ? (
            <p className="text-slate">
              {breakdown.scope.category.kind === "all" ? "No spending" : `No spending in ${name}`}{" "}
              in {period.label}. Choose another period above.
            </p>
          ) : (
            <BreakdownTable
              breakdown={breakdown}
              period={period}
              previousLabel={periodLabel(breakdown.comparison)}
              narrowing={narrowing}
            />
          )}
        </section>
      )}
    </div>
  );
}

import type { MonthAnalysis, MonthCategoryLine } from "@ironcage/contracts/schema";
import { uncategorizedCategoryId } from "@ironcage/domain";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@ironcage/ui/components/card";
import { cn } from "@ironcage/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { BigDecimal } from "effect";

import { formatAud } from "@/features/money/format";

const byAmountDescending = (a: MonthCategoryLine, b: MonthCategoryLine) =>
  BigDecimal.Order(b.amount, a.amount);

function CategoryRow({
  line,
  scale,
}: {
  readonly line: MonthCategoryLine;
  readonly scale: number;
}) {
  const refunded = BigDecimal.isNegative(line.amount);
  const share =
    scale === 0 || refunded
      ? 0
      : BigDecimal.toNumberUnsafe(BigDecimal.abs(line.amount)) / scale;
  const uncategorized = line.categoryId === uncategorizedCategoryId;

  return (
    <div className="grid grid-cols-[minmax(7rem,10rem)_1fr_7.5rem] items-center gap-4">
      <span className={cn("truncate text-sm", uncategorized && "text-warning")}>
        {line.name}
        {uncategorized ? (
          <Link to="/money/review" className="ml-2 text-xs underline underline-offset-4">
            review
          </Link>
        ) : null}
      </span>
      <div className="h-2 rounded-[4px] bg-chart-fill">
        <div
          className={cn("h-full rounded-[4px]", uncategorized ? "bg-warning/70" : "bg-chart-1")}
          style={{ width: `${Math.max(share * 100, refunded ? 0 : 0.75)}%` }}
        />
      </div>
      <span
        className={cn(
          "text-right font-mono text-sm tabular-nums",
          refunded ? "text-live" : "text-foreground",
        )}
      >
        {formatAud(BigDecimal.abs(line.amount), { sign: "none" })}
        {refunded ? " back" : ""}
      </span>
    </div>
  );
}

/**
 * Where the month went. Expense bars share one scale — the largest category —
 * so length reads as proportion. A category refunded past zero prints as
 * money back rather than being clamped to nothing.
 */
export function CategoryBreakdown({ month }: { readonly month: MonthAnalysis }) {
  const expenses = month.categories.filter((line) => line.kind === "expense").sort(byAmountDescending);
  const incomes = month.categories.filter((line) => line.kind === "income").sort(byAmountDescending);
  const scale = expenses
    .filter((line) => !BigDecimal.isNegative(line.amount))
    .reduce((max, line) => Math.max(max, BigDecimal.toNumberUnsafe(line.amount)), 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-lg tracking-tight">By category</CardTitle>
        <CardDescription>
          Net of refunds. Transfers between your own accounts are excluded.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {expenses.length === 0 && incomes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity recorded in this month.</p>
        ) : null}
        {expenses.length > 0 ? (
          <div className="flex flex-col gap-2.5">
            {expenses.map((line) => (
              <CategoryRow key={line.categoryId} line={line} scale={scale} />
            ))}
          </div>
        ) : null}
        {incomes.length > 0 ? (
          <div className="flex flex-col gap-2 border-t pt-4">
            <span className="font-mono text-[11px] tracking-[0.14em] text-ink-faint uppercase">
              Income
            </span>
            {incomes.map((line) => (
              <div
                key={line.categoryId}
                className="grid grid-cols-[minmax(7rem,10rem)_1fr_7.5rem] items-center gap-4"
              >
                <span className="truncate text-sm">{line.name}</span>
                <span />
                <span className="text-right font-mono text-sm text-foreground tabular-nums">
                  {formatAud(line.amount, { sign: "none" })}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

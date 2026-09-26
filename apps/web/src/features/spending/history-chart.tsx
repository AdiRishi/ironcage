import type { SpendingBreakdown, YearMonth } from "@repo/contracts/finance";
import { monthLabel } from "@repo/finance";
import { cn } from "cn";
import { useState } from "react";

import { barScale, MonthBar, monthAmountText } from "@/components/month-bar";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { monthInitial, type PeriodChoice } from "@/lib/period";

// The open scope over the twelve months that end with the selected period, with the
// selected months inked. The same months read as a table on request.
export function HistoryChart({
  label,
  months,
  color,
  period,
}: {
  label: string;
  months: SpendingBreakdown["months"];
  color: string;
  period: PeriodChoice;
}) {
  const [asTable, setAsTable] = useState(false);
  const height = barScale(months.map((item) => item.amount));
  const selected = (month: YearMonth) => period.from <= month && month <= period.to;
  const caption = `${label}, the twelve months to ${monthLabel(period.to)}`;
  return (
    <figure className="min-w-0 space-y-2 lg:self-end">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4">
        <span className="type-small text-slate">{caption}</span>
        <Button
          variant="link"
          size="xs"
          className="px-0"
          onClick={() => setAsTable((value) => !value)}
        >
          {asTable ? "Show the chart" : "Show as a table"}
        </Button>
      </figcaption>
      {asTable ? (
        <Table>
          <TableCaption className="sr-only">{caption}</TableCaption>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead scope="col" className="px-0 type-small font-normal text-slate">
                Month
              </TableHead>
              <TableHead scope="col" className="px-0 text-right type-small font-normal text-slate">
                Spent
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {months.map((item) => (
              <TableRow key={item.month} className="border-rule hover:bg-transparent">
                <TableHead scope="row" className="h-auto px-0 py-1.5 font-normal">
                  {monthLabel(item.month)}
                </TableHead>
                <TableCell
                  className={cn(
                    "px-0 py-1.5 text-right tabular",
                    item.coverage !== "complete" && "text-slate",
                  )}
                >
                  {monthAmountText(item.amount, item.coverage)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <ol className="flex items-end gap-1.5">
          {months.map((item) => {
            const text = `${monthLabel(item.month)}: ${monthAmountText(item.amount, item.coverage)}`;
            return (
              <li
                key={item.month}
                title={text}
                className="flex min-w-0 flex-1 flex-col items-center gap-1"
              >
                <span aria-hidden className="flex h-20 w-full items-end">
                  <MonthBar
                    coverage={item.coverage}
                    height={height(item.amount)}
                    color={color}
                    selected={selected(item.month)}
                  />
                </span>
                <span aria-hidden className="type-condensed text-slate">
                  {monthInitial(item.month)}
                </span>
                <span className="sr-only">{text}</span>
              </li>
            );
          })}
        </ol>
      )}
    </figure>
  );
}

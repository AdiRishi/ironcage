import type { CounterpartyDetail } from "@repo/contracts/finance";
import { monthLabel } from "@repo/finance";
import { cn } from "cn";
import { useState } from "react";

import { Amount } from "@/components/amount";
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

type Month = (typeof CounterpartyDetail.Type)["months"][number];

// What you paid and received in one month, in words. A month without records says so
// once, rather than once for each direction.
function monthText(month: Month, paid: boolean, received: boolean) {
  if (month.coverage === "missing") return monthAmountText(month.outflow, month.coverage);
  return [
    paid ? monthAmountText(month.outflow, month.coverage, "paid") : null,
    received ? monthAmountText(month.inflow, month.coverage, "received") : null,
  ]
    .filter((part) => part !== null)
    .join(", ");
}

// A month's bar where it has money, and an outline wherever records are missing.
function Bar({
  month,
  amount,
  height,
  color,
}: {
  month: Month;
  amount: Month["outflow"];
  height: ReturnType<typeof barScale>;
  color: string;
}) {
  if (amount.minor <= 0n && month.coverage === "complete") return null;
  return <MonthBar coverage={month.coverage} height={height(amount)} color={color} selected />;
}

// Every month from the first with records to the last, evenly spaced in time. Money
// paid rises above the line and money received hangs below it, on one scale, so a
// counterparty that both takes and gives shows both. Months with records missing are
// drawn as outlines, as on every chart of months. The same months read as a table on
// request.
export function Activity({
  detail: { counterparty, months },
  color,
}: {
  detail: typeof CounterpartyDetail.Type;
  color: string;
}) {
  const [asTable, setAsTable] = useState(false);
  const [first] = months;
  const last = months.at(-1);
  if (!first || !last) return null;
  const paid = months.some((month) => month.outflow.minor !== 0n);
  const received = months.some((month) => month.inflow.minor !== 0n);
  const height = barScale(months.flatMap((month) => [month.outflow, month.inflow]));
  const caption = `${counterparty.name} by month, ${monthLabel(first.month)} to ${monthLabel(last.month)}`;
  return (
    <section aria-labelledby="activity-heading" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <h2 id="activity-heading" className="type-heading">
          Over time
        </h2>
        <Button
          variant="link"
          size="xs"
          className="px-0"
          onClick={() => setAsTable((value) => !value)}
        >
          {asTable ? "Show the chart" : "Show as a table"}
        </Button>
      </div>
      <p className="type-small text-slate">
        {counterparty.outflow.minor > 0n && (
          <>
            Paid <Amount value={counterparty.outflow} cents={false} /> in total.{" "}
          </>
        )}
        {counterparty.inflow.minor > 0n && (
          <>
            Received <Amount value={counterparty.inflow} cents={false} /> in total.
          </>
        )}
      </p>
      {asTable ? (
        <Table className="type-body!">
          <TableCaption className="sr-only">{caption}</TableCaption>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead scope="col" className="px-0 type-small font-normal text-slate">
                Month
              </TableHead>
              {paid && (
                <TableHead scope="col" className="text-right type-small font-normal text-slate">
                  Paid
                </TableHead>
              )}
              {received && (
                <TableHead
                  scope="col"
                  className="pr-0 text-right type-small font-normal text-slate"
                >
                  Received
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {months.map((month) => (
              <TableRow key={month.month} className="border-rule hover:bg-transparent">
                <TableHead scope="row" className="h-auto px-0 py-1.5 font-normal">
                  {monthLabel(month.month)}
                </TableHead>
                {paid && (
                  <TableCell
                    className={cn(
                      "py-1.5 text-right tabular",
                      month.coverage !== "complete" && "text-slate",
                    )}
                  >
                    {monthAmountText(month.outflow, month.coverage)}
                  </TableCell>
                )}
                {received && (
                  <TableCell
                    className={cn(
                      "py-1.5 pr-0 text-right tabular",
                      month.coverage !== "complete" && "text-slate",
                    )}
                  >
                    {monthAmountText(month.inflow, month.coverage)}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <ol aria-label={caption} className="relative flex gap-[3px] overflow-x-auto pb-1">
          {months.map((month, index) => {
            const text = `${monthLabel(month.month)}: ${monthText(month, paid, received)}`;
            return (
              <li key={month.month} title={text} className="flex w-3 shrink-0 flex-col gap-1">
                {paid && (
                  <span aria-hidden className="flex h-24 items-end">
                    <Bar month={month} amount={month.outflow} height={height} color={color} />
                  </span>
                )}
                {received && (
                  <span aria-hidden className="flex h-24 -scale-y-100 items-end">
                    <Bar
                      month={month}
                      amount={month.inflow}
                      height={height}
                      color="var(--eucalypt)"
                    />
                  </span>
                )}
                <span
                  aria-hidden
                  className="h-4 overflow-visible type-condensed whitespace-nowrap text-slate"
                >
                  {month.month.endsWith("-01") || (index === 0 && month.month.slice(5) <= "09")
                    ? month.month.slice(0, 4)
                    : ""}
                </span>
                <span className="sr-only">{text}</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

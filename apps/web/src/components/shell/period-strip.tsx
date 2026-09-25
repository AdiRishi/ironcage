import type { MonthlyFlow } from "@repo/contracts/finance";
import { formatCurrency, monthLabel } from "@repo/finance";
import { Link, useNavigate } from "@tanstack/react-router";
import { cn } from "cn";
import { useEffect, useRef } from "react";

import { monthInitial, type PeriodChoice } from "@/lib/period";

import { MonthRangePicker } from "./month-range-picker";

// One short bar per month of outflow. It is the period control and a picture of the
// whole history at once. A month with no records is an outline, never a zero bar.
export function PeriodStrip({
  months,
  period,
}: {
  months: typeof MonthlyFlow.Type;
  period: PeriodChoice;
}) {
  const navigate = useNavigate();
  const list = useRef<HTMLOListElement>(null);
  const selected = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    const container = list.current?.getBoundingClientRect();
    const item = selected.current?.getBoundingClientRect();
    if (!list.current || !container || !item) return;
    list.current.scrollLeft += item.left - container.left - (container.width - item.width) / 2;
  }, [period.from, period.to]);
  const largest = months.reduce(
    (max, month) => (month.outflow.minor > max ? month.outflow.minor : max),
    1n,
  );
  const years = [...new Set(months.map((month) => month.month.slice(0, 4)))];
  const isSelected = (month: string) => period.from <= month && month <= period.to;
  const lastSelected = months.findLast((month) => isSelected(month.month))?.month;
  const isYear = (year: string) => period.from === `${year}-01` && period.to === `${year}-12`;
  return (
    <nav aria-label="Period" className="border-b border-rule">
      <div className="mx-auto flex max-w-[1280px] items-center gap-2 px-5 md:px-8">
        <ol
          ref={list}
          className="flex min-w-0 flex-1 [scrollbar-width:none] gap-4 overflow-x-auto pt-3 pb-2"
        >
          {years.map((year) => (
            <li key={year} className="flex shrink-0 flex-col gap-1">
              <ol className="flex items-end gap-[3px]">
                {months
                  .filter((month) => month.month.startsWith(year))
                  .map((month) => {
                    const active = isSelected(month.month);
                    const height = Number((month.outflow.minor * 100n) / largest);
                    return (
                      <li key={month.month}>
                        <Link
                          to="."
                          search={(previous) => ({ ...previous, period: month.month })}
                          ref={month.month === lastSelected ? selected : undefined}
                          aria-current={
                            period.from === month.month && period.to === month.month
                              ? "true"
                              : undefined
                          }
                          aria-label={`${monthLabel(month.month)}, ${formatCurrency(month.outflow, { cents: false })} went out${month.coverage === "missing" ? ", no records" : month.coverage === "partial" ? ", some records missing" : ""}`}
                          className="group flex w-6 flex-col items-center gap-1 rounded-sm"
                        >
                          <span className="flex h-9 w-full items-end">
                            {month.coverage === "missing" ? (
                              <span
                                className={cn(
                                  "h-2 w-full rounded-t-[3px] border border-b-0 border-dashed",
                                  active ? "border-intaglio" : "border-slate/60",
                                )}
                              />
                            ) : (
                              <span
                                className={cn(
                                  "w-full rounded-t-[3px] transition-colors",
                                  active
                                    ? "bg-intaglio"
                                    : month.coverage === "partial"
                                      ? "bg-outflow/35 group-hover:bg-outflow/60"
                                      : "bg-outflow/60 group-hover:bg-outflow/85",
                                )}
                                style={{ height: `${Math.max(height, 4)}%` }}
                              />
                            )}
                          </span>
                          <span
                            className={cn(
                              "type-condensed",
                              active ? "text-intaglio" : "text-slate",
                            )}
                            aria-hidden
                          >
                            {monthInitial(month.month)}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
              </ol>
              <Link
                to="."
                search={(previous) => ({ ...previous, period: year })}
                aria-current={isYear(year) ? "true" : undefined}
                className={cn(
                  "type-small tabular self-start rounded-sm",
                  isYear(year) ? "font-[620] text-intaglio" : "text-slate hover:text-intaglio",
                )}
              >
                {year}
              </Link>
            </li>
          ))}
        </ol>
        <MonthRangePicker
          months={months.map((month) => month.month)}
          period={period}
          onChange={(key) => {
            navigate({ to: ".", search: (previous) => ({ ...previous, period: key }) }).catch(
              reportError,
            );
          }}
        />
      </div>
    </nav>
  );
}

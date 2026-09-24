import type { MonthlyFlow } from "@repo/contracts/finance";
import { formatCurrency } from "@repo/finance";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { monthInitial, monthLabel, type ResolvedPeriod } from "@/lib/period";
import { cn } from "@/lib/utils";

// One short bar per month of outflow. It is the period control and a picture of the
// whole history at once. A month with no records is an outline, never a zero bar.
export function PeriodStrip({
  months,
  period,
}: {
  months: typeof MonthlyFlow.Type;
  period: ResolvedPeriod;
}) {
  const selected = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    selected.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [period.key]);
  const largest = months.reduce(
    (max, month) => (month.outflow.minor > max ? month.outflow.minor : max),
    1n,
  );
  const years = [...new Set(months.map((month) => month.month.slice(0, 4)))];
  const isSelected = (month: string) =>
    period.unit === "year"
      ? month.startsWith(String(period.year))
      : month === `${period.year}-${String(period.month).padStart(2, "0")}`;
  return (
    <nav aria-label="Period" className="border-b border-rule">
      <div className="mx-auto max-w-[1280px] px-5 md:px-8">
        <ol className="flex [scrollbar-width:none] gap-4 overflow-x-auto pt-3 pb-2">
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
                          ref={active && period.unit === "month" ? selected : undefined}
                          aria-current={active && period.unit === "month" ? "true" : undefined}
                          aria-label={`${monthLabel(month.month)}, ${formatCurrency(month.outflow, { cents: false })} went out${month.coverage === "missing" ? ", no records" : month.coverage === "partial" ? ", some records missing" : ""}`}
                          className="group flex w-6 flex-col items-center gap-1 rounded-sm"
                        >
                          <span className="flex h-9 w-full items-end">
                            {month.coverage === "missing" ? (
                              <span className="h-2 w-full rounded-t-[3px] border border-b-0 border-dashed border-slate/60" />
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
                aria-current={
                  period.unit === "year" && String(period.year) === year ? "true" : undefined
                }
                className={cn(
                  "type-small tabular self-start rounded-sm",
                  period.unit === "year" && String(period.year) === year
                    ? "font-[620] text-intaglio"
                    : "text-slate hover:text-intaglio",
                )}
              >
                {year}
              </Link>
            </li>
          ))}
        </ol>
      </div>
    </nav>
  );
}

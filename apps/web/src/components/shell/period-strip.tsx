import type { MonthlyFlow } from "@repo/contracts/finance";
import { monthLabel } from "@repo/finance";
import { Link, ScriptOnce, useNavigate } from "@tanstack/react-router";
import { cn } from "cn";
import { Struct } from "effect";
import { useEffect, useRef } from "react";

import { barScale, MonthBar, monthAmountText } from "@/components/month-bar";
import { monthInitial, type PeriodChoice } from "@/lib/period";

import { MonthRangePicker } from "./month-range-picker";

const verbs = { spending: "spent", outflow: "went out" } as const;

// Centres the last selected month in the strip. The server's HTML also runs it inline
// right after the strip's row, once Choose months has taken its place beside the list and
// the list has its final width, so a long history opens on the selected period before the
// page hydrates. It must stay self-contained to run from its source text.
function centreSelected(list: Element | null) {
  const item = list?.querySelector("[data-selected]");
  if (!list || !item) return;
  const box = list.getBoundingClientRect();
  const at = item.getBoundingClientRect();
  list.scrollLeft += at.left - box.left - (box.width - at.width) / 2;
}

// One short bar per month, of spending on the Spending screen and of outflow elsewhere.
// It is the period control and a picture of the whole history at once. Months draw their
// coverage like every other monthly chart. Choosing a period drops the ledger's page
// cursor, which belongs to the period it was read in.
export function PeriodStrip({
  months,
  period,
  measure,
}: {
  months: typeof MonthlyFlow.Type;
  period: PeriodChoice;
  measure: keyof typeof verbs;
}) {
  const navigate = useNavigate();
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    centreSelected(list.current);
  }, [period.from, period.to]);
  const height = barScale(months.map((month) => month[measure]));
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
                    const amount = month[measure];
                    return (
                      <li key={month.month}>
                        <Link
                          to="."
                          search={(previous) => ({
                            ...Struct.omit(previous, ["cursor"]),
                            period: month.month,
                          })}
                          data-selected={month.month === lastSelected || undefined}
                          aria-current={
                            period.from === month.month && period.to === month.month
                              ? "true"
                              : undefined
                          }
                          aria-label={`${monthLabel(month.month)}, ${monthAmountText(amount, month.coverage, verbs[measure])}`}
                          className="group flex w-6 flex-col items-center gap-1 rounded-sm"
                        >
                          <span className="flex h-9 w-full items-end">
                            <MonthBar
                              coverage={month.coverage}
                              height={height(amount)}
                              color={active ? "var(--intaglio)" : "var(--wattle)"}
                              selected={active}
                            />
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
                search={(previous) => ({
                  ...Struct.omit(previous, ["cursor"]),
                  period: Number(year),
                })}
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
            navigate({
              to: ".",
              search: (previous) => ({ ...Struct.omit(previous, ["cursor"]), period: key }),
            }).catch(reportError);
          }}
        />
        <ScriptOnce>{`(${centreSelected.toString()})(document.currentScript.parentElement.querySelector("ol"))`}</ScriptOnce>
      </div>
    </nav>
  );
}

import type { MonthAnalysis } from "@ironcage/contracts/schema";
import { Card, CardContent, CardDescription, CardHeader } from "@ironcage/ui/components/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ironcage/ui/components/tooltip";
import { cn } from "@ironcage/ui/lib/utils";
import { BigDecimal } from "effect";

import { Eyebrow } from "@/features/money/components/eyebrow";
import { formatAud, formatMonth } from "@/features/money/format";

const CHART_HEIGHT = 112;

/**
 * Net spend by month, last twelve. An incomplete month is drawn hatched in
 * the warning colour — its bar shows what's on record without claiming the
 * month is comparable, and the spec forbids drawing a gap as zero.
 */
export function SpendTrend({
  months,
  selected,
  onSelect,
}: {
  /** Ascending by month. */
  readonly months: readonly MonthAnalysis[];
  readonly selected: string;
  readonly onSelect: (month: string) => void;
}) {
  const shown = months.slice(-12);
  const scale = shown.reduce(
    (max, month) => BigDecimal.max(max, BigDecimal.abs(month.netSpend)),
    BigDecimal.fromBigInt(0n),
  );
  const scaleNumber = BigDecimal.toNumberUnsafe(scale);

  return (
    <Card>
      <CardHeader>
        <Eyebrow>Net spend by month</Eyebrow>
        <CardDescription>
          {shown.some((month) => !month.complete)
            ? "Hatched months have a coverage gap and show a running figure only."
            : "Every month shown is fully covered."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-end gap-2 border-b pb-px" style={{ height: CHART_HEIGHT + 1 }}>
          {shown.map((month) => {
            const magnitude =
              scaleNumber === 0
                ? 0
                : BigDecimal.toNumberUnsafe(BigDecimal.abs(month.netSpend)) / scaleNumber;
            const height = Math.max(Math.round(magnitude * CHART_HEIGHT), 3);
            const active = month.month === selected;
            const refunds = BigDecimal.isNegative(month.netSpend);
            const style = month.complete
              ? { height }
              : {
                  height,
                  backgroundImage:
                    "repeating-linear-gradient(135deg, transparent 0 3px, color-mix(in oklab, var(--warning) 55%, transparent) 3px 5px)",
                };

            return (
              <Tooltip key={month.month}>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label={`${formatMonth(month.month)}, ${formatAud(month.netSpend, { sign: "none" })} net spend${month.complete ? "" : ", incomplete"}`}
                      aria-pressed={active}
                      onClick={() => onSelect(month.month)}
                      className="group flex h-full max-w-12 flex-1 cursor-pointer items-end outline-none"
                    />
                  }
                >
                  <span
                    style={style}
                    className={cn(
                      "w-full rounded-t-[4px] transition-colors",
                      month.complete &&
                        (active ? "bg-chart-1" : "bg-chart-1/40 group-hover:bg-chart-1/65"),
                      !month.complete && "border border-b-0 border-dashed border-warning/50",
                      active && "ring-2 ring-ring/40",
                    )}
                  />
                </TooltipTrigger>
                <TooltipContent>
                  <span className="font-mono">
                    {formatMonth(month.month)} · {formatAud(month.netSpend, { sign: "none" })}
                    {refunds ? " net refunds" : " net spend"}
                    {month.complete ? "" : " so far — incomplete"}
                  </span>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
        <div className="mt-1.5 flex gap-2">
          {shown.map((month) => (
            <span
              key={month.month}
              className={cn(
                "max-w-12 flex-1 text-center font-mono text-[10px]",
                month.month === selected ? "text-foreground" : "text-ink-faint",
              )}
            >
              {new Date(`${month.month}-01T00:00:00Z`).toLocaleDateString("en-AU", {
                month: "short",
                timeZone: "UTC",
              })}
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

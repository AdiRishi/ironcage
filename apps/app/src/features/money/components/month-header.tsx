import type { MonthAnalysis } from "@ironcage/contracts/schema";
import { cn } from "@ironcage/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { BigDecimal } from "effect";
import { TriangleAlertIcon } from "lucide-react";

import { MonthSwitcher } from "@/features/money/components/month-switcher";
import { formatAud, formatMonth, formatRate } from "@/features/money/format";

/** How the month's net spend sits against its trailing three-month average. */
function spendComparison(month: MonthAnalysis): { text: string; tone: string } | null {
  if (!month.complete || month.trailingThreeMonthNetSpend === null) return null;
  const delta = BigDecimal.subtract(month.netSpend, month.trailingThreeMonthNetSpend);
  if (BigDecimal.isZero(delta)) return { text: "level with avg", tone: "text-muted-foreground" };
  const share = BigDecimal.toNumberUnsafe(month.trailingThreeMonthNetSpend);
  const percent =
    share === 0 ? null : Math.round((Math.abs(BigDecimal.toNumberUnsafe(delta)) / share) * 100);
  const magnitude =
    percent === null ? formatAud(BigDecimal.abs(delta), { sign: "none" }) : `${percent}%`;
  return BigDecimal.isNegative(delta)
    ? { text: `▼ ${magnitude} vs avg`, tone: "text-live" }
    : { text: `▲ ${magnitude} vs avg`, tone: "text-warning" };
}

function Figure({
  label,
  value,
  tone,
  note,
}: {
  readonly label: string;
  readonly value: string;
  readonly tone?: string | undefined;
  readonly note?: { text: string; tone: string } | null | undefined;
}) {
  return (
    <span className="font-mono text-xs text-muted-foreground">
      {label} <span className={cn("font-semibold text-foreground", tone)}>{value}</span>
      {note ? <span className={cn("ml-1.5", note.tone)}>{note.text}</span> : null}
    </span>
  );
}

/**
 * The month named once, its three figures inline beside it, and its
 * completeness stated before any of them can be read as comparable.
 */
export function MonthHeader({
  months,
  month,
  onSelect,
}: {
  readonly months: readonly MonthAnalysis[];
  readonly month: MonthAnalysis;
  readonly onSelect: (month: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="font-display text-[22px] font-semibold tracking-tight">
          {formatMonth(month.month)}
        </h2>
        <MonthSwitcher months={months} selected={month.month} onSelect={onSelect} />
        <div className="ml-auto flex flex-wrap items-center gap-5">
          <Figure label="income" value={formatAud(month.income, { sign: "none" })} />
          <Figure
            label="spent"
            value={formatAud(month.netSpend, { sign: "none" })}
            note={spendComparison(month)}
          />
          <Figure
            label="savings rate"
            value={month.savingsRate === null ? "—" : formatRate(month.savingsRate)}
            tone={month.savingsRate === null ? "text-muted-foreground" : "text-live"}
          />
        </div>
      </div>
      {month.complete ? null : (
        <p className="flex items-center gap-2 font-mono text-[11px] text-warning">
          <TriangleAlertIcon className="size-3.5" />
          Incomplete month — a required account has a gap. Figures show what's on record;
          comparisons and reports exclude it until the gap closes.
          <Link to="/money/import" className="underline underline-offset-4">
            Close the gap
          </Link>
        </p>
      )}
    </div>
  );
}

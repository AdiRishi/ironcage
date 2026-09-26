import type { CoverageState, Money, YearMonth } from "@repo/contracts/finance";
import { monthLabel } from "@repo/finance";
import { Array as Arr } from "effect";

import { barScale, MonthBar, monthAmountText } from "./month-bar";

// A row's months as small bars, drawn and read out with the same coverage rules as the
// chart they sit under.
export function Sparkline({
  label,
  months,
  values,
  color,
  selected,
}: {
  label: string;
  // The months drawn, each with whether its records are complete.
  months: readonly { month: YearMonth; coverage: CoverageState }[];
  values: readonly Money[];
  color: string;
  selected: (month: YearMonth) => boolean;
}) {
  const height = barScale(values);
  const bars = Arr.zipWith(months, values, (month, value) => ({
    ...month,
    value,
    text: `${monthLabel(month.month)}: ${monthAmountText(value, month.coverage)}`,
  }));
  return (
    <>
      <span className="sr-only">{`${label} by month. ${bars.map((bar) => bar.text).join(", ")}.`}</span>
      <span aria-hidden className="flex h-6 w-[118px] items-end gap-0.5">
        {bars.map((bar) => (
          <span key={bar.month} title={bar.text} className="flex h-full w-2 items-end">
            <MonthBar
              coverage={bar.coverage}
              height={height(bar.value)}
              color={color}
              selected={selected(bar.month)}
            />
          </span>
        ))}
      </span>
    </>
  );
}

import type { CoverageState, Money } from "@repo/contracts/finance";
import { formatCurrency } from "@repo/finance";
import { cn } from "cn";

// A bar's height as a percent of the largest amount. Money back has no height.
export function barScale(amounts: readonly Money[]) {
  const largest = amounts.reduce((max, { minor }) => (minor > max ? minor : max), 0n);
  return ({ minor }: Money) => (minor > 0n ? Number((minor * 1000n) / largest) / 10 : 0);
}

// A month's amount in words, with what the money did, such as "spent", where nothing
// around it says. A month without records is not zero, and a month with some records
// missing spent at least its amount.
export function monthAmountText(amount: Money, coverage: CoverageState, verb?: string) {
  if (coverage === "missing") return "no records";
  const figure = formatCurrency(amount, { cents: false });
  const text = verb ? `${figure} ${verb}` : figure;
  return coverage === "partial" ? `${text}, some records missing` : text;
}

// One month of a bar chart, `height` percent tall. A month without records is a short
// dashed outline, never a zero bar. A month with some records missing is an outline at
// the height its records reach, because its amount is a lower bound. Months outside the
// selected period are faded.
export function MonthBar({
  coverage,
  height,
  color,
  selected,
}: {
  coverage: CoverageState;
  height: number;
  color: string;
  selected: boolean;
}) {
  if (coverage === "missing")
    return (
      <span
        className={cn(
          "block h-2 w-full rounded-t-[3px] border border-b-0 border-dashed",
          selected ? "border-intaglio" : "border-slate/60",
        )}
      />
    );
  const size = `${Math.max(height, 3)}%`;
  return (
    <span
      className={cn(
        "block w-full rounded-t-[3px] transition-opacity",
        coverage === "partial" && "border-[1.5px] border-b-0",
        !selected && "opacity-50 group-hover:opacity-80",
      )}
      style={
        coverage === "partial"
          ? { height: size, borderColor: color }
          : { height: size, background: color }
      }
    />
  );
}

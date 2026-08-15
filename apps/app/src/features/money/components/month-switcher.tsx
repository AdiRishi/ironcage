import type { MonthAnalysis } from "@ironcage/contracts/schema";
import { Button } from "@ironcage/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ironcage/ui/components/select";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { formatMonth } from "@/features/money/format";

/** Steps through the months on record; the URL owns the selection. */
export function MonthSwitcher({
  months,
  selected,
  onSelect,
}: {
  /** Ascending by month. */
  readonly months: readonly MonthAnalysis[];
  readonly selected: string;
  readonly onSelect: (month: string) => void;
}) {
  const index = months.findIndex((month) => month.month === selected);
  const previous = index > 0 ? months[index - 1] : undefined;
  const next = index >= 0 && index < months.length - 1 ? months[index + 1] : undefined;

  return (
    <div className="flex items-center gap-1.5">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Previous month"
        disabled={previous === undefined}
        onClick={() => previous && onSelect(previous.month)}
      >
        <ChevronLeftIcon />
      </Button>
      <Select
        value={selected}
        onValueChange={(month) => {
          if (typeof month === "string") onSelect(month);
        }}
      >
        <SelectTrigger size="sm" className="min-w-40 font-mono text-xs" aria-label="Month">
          <SelectValue>{formatMonth(selected)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {[...months].reverse().map((month) => (
            <SelectItem key={month.month} value={month.month}>
              <span className="font-mono text-xs">
                {formatMonth(month.month)}
                {month.complete ? "" : " · partial"}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Next month"
        disabled={next === undefined}
        onClick={() => next && onSelect(next.month)}
      >
        <ChevronRightIcon />
      </Button>
    </div>
  );
}

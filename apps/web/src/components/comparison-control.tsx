import { CalendarDate, type Period, type YearMonth } from "@repo/contracts/finance";
import {
  addDays,
  daysInPeriod,
  monthCount,
  monthsPeriod,
  periodLabel,
  yearMonthStart,
} from "@repo/finance";
import { DateTime, Schema } from "effect";
import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import { enAU } from "react-day-picker/locale";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { type ComparisonKey, type PeriodChoice, wholeComparison } from "@/lib/period";

const Choice = Schema.Literals(["previous", "lastYear", "dates"]);
type Choice = typeof Choice.Type;

// react-day-picker selects local midnights, so dates cross into it and back through
// local parts. Going through UTC would move every date east of Greenwich a day earlier.
function localDate(on: CalendarDate) {
  const { year, month, day } = DateTime.toPartsUtc(DateTime.makeUnsafe(on));
  return new Date(year, month - 1, day);
}
function calendarDate(date: Date) {
  return CalendarDate.make(
    DateTime.formatIsoDateUtc(
      DateTime.makeUnsafe({
        year: date.getFullYear(),
        month: date.getMonth() + 1,
        day: date.getDate(),
      }),
    ),
  );
}

function previousName(period: PeriodChoice) {
  const months = monthCount(period.from, period.to);
  if (months === 12 && period.from.endsWith("-01")) return "The year before";
  return months === 1 ? "The month before" : `The ${months} months before`;
}

// The comparison under the overview and spending titles: what the period is compared
// with, and a popover to compare with the period before, the same period last year, or
// chosen dates.
export function ComparisonControl({
  period,
  current,
  comparison,
  value,
  onChange,
  firstMonth,
  today,
}: {
  period: PeriodChoice;
  // The dates the result covers, for the period and for its comparison.
  current: Period;
  comparison: Period;
  value: ComparisonKey | undefined;
  onChange: (value: ComparisonKey | undefined) => void;
  // The calendar offers days from the first month with records through today.
  firstMonth: YearMonth;
  today: CalendarDate;
}) {
  const [open, setOpen] = useState(false);
  const whole = wholeComparison(period, value);
  const name = periodLabel(whole);
  const elapsed = current.endExclusive < monthsPeriod(period.from, period.to).endExclusive;
  // A period in progress compares with the same days of the whole comparison, which on
  // 30 March are all of February. Chosen dates are compared as chosen.
  const sameDays = comparison.endExclusive < whole.endExclusive ? "the same days of " : "";
  const days = daysInPeriod(current);
  return (
    <p className="type-small text-slate">
      {elapsed ? `${days} ${days === 1 ? "day" : "days"} so far, compared with ` : "Compared with "}
      {sameDays}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          aria-label={`Compared with ${sameDays}${name}. Choose another comparison`}
          render={
            <Button
              variant="link"
              className="h-auto gap-0.5 p-0 align-baseline type-small font-[560] text-intaglio"
            />
          }
        >
          {name}
          <ChevronDown aria-hidden className="size-3.5" />
        </PopoverTrigger>
        <PopoverContent align="start" className="max-h-(--available-height) w-auto overflow-y-auto">
          <ComparisonChoices
            period={period}
            comparison={comparison}
            value={value}
            firstMonth={firstMonth}
            today={today}
            onChange={(next) => {
              onChange(next);
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
    </p>
  );
}

function ComparisonChoices({
  period,
  comparison,
  value,
  firstMonth,
  today,
  onChange,
}: {
  period: PeriodChoice;
  comparison: Period;
  value: ComparisonKey | undefined;
  firstMonth: YearMonth;
  today: CalendarDate;
  onChange: (value: ComparisonKey | undefined) => void;
}) {
  const id = useId();
  // Twelve months back is both the period before and the same period last year.
  const yearLong = monthCount(period.from, period.to) === 12;
  const dated = value !== undefined && value !== "lastYear";
  const [choice, setChoice] = useState<Choice>(
    dated ? "dates" : value === "lastYear" && !yearLong ? "lastYear" : "previous",
  );
  // The calendar opens on the dates compared now. `to` is null while only the first
  // day of a new range is chosen, which compares with that one day.
  const [dates, setDates] = useState<{ from: CalendarDate; to: CalendarDate | null }>({
    from: comparison.start,
    to: addDays(comparison.endExclusive, -1),
  });
  const options = [
    {
      value: "previous",
      label: previousName(period),
      name: periodLabel(wholeComparison(period, undefined)),
    },
    {
      value: "lastYear",
      label: "The same period last year",
      name: periodLabel(wholeComparison(period, "lastYear")),
    },
    {
      value: "dates",
      label: "Chosen dates",
      name: dated ? periodLabel(wholeComparison(period, value)) : null,
    },
  ].filter((option) => !(yearLong && option.value === "lastYear"));
  return (
    <div className="space-y-4">
      <PopoverTitle id={`${id}-title`} className="font-[560]">
        Compare with
      </PopoverTitle>
      <RadioGroup
        aria-labelledby={`${id}-title`}
        value={choice}
        onValueChange={(next) => {
          if (Schema.is(Choice)(next)) setChoice(next);
        }}
      >
        {options.map((option) => (
          <label key={option.value} className="flex items-start gap-3">
            <RadioGroupItem value={option.value} className="mt-0.5" />
            <span>
              {option.label}
              {option.name && <span className="block type-small text-slate">{option.name}</span>}
            </span>
          </label>
        ))}
      </RadioGroup>
      {choice === "dates" && (
        <Calendar
          mode="range"
          required
          resetOnSelect
          numberOfMonths={2}
          captionLayout="dropdown"
          locale={enAU}
          weekStartsOn={1}
          defaultMonth={localDate(dates.from)}
          startMonth={localDate(yearMonthStart(firstMonth))}
          endMonth={localDate(today)}
          today={localDate(today)}
          disabled={{ after: localDate(today) }}
          selected={{ from: localDate(dates.from), to: dates.to ? localDate(dates.to) : undefined }}
          onSelect={(range) => {
            if (range.from)
              setDates({
                from: calendarDate(range.from),
                to: range.to ? calendarDate(range.to) : null,
              });
          }}
          className="p-0"
        />
      )}
      <Button
        onClick={() => {
          onChange(
            choice === "previous"
              ? undefined
              : choice === "lastYear"
                ? "lastYear"
                : `${dates.from}..${dates.to ?? dates.from}`,
          );
        }}
      >
        Compare
      </Button>
    </div>
  );
}

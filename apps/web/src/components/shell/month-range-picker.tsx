import { YearMonth } from "@repo/contracts/finance";
import { monthCount, monthLabel, shiftYearMonth } from "@repo/finance";
import { useForm } from "@tanstack/react-form";
import { Schema } from "effect";
import { CalendarRange } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { periodKey, type PeriodChoice, type PeriodKey } from "@/lib/period";

const Fields = Schema.Struct({ from: YearMonth, to: YearMonth }).check(
  Schema.makeFilter(
    (range) =>
      range.from <= range.to || {
        path: ["to"],
        issue: "Choose a first month on or before the last.",
      },
  ),
);

// Chooses a run of months, for periods the strip's single months and years cannot
// select. It offers every month of the history, and the chosen months when they fall
// outside it.
export function MonthRangePicker({
  months,
  period,
  onChange,
}: {
  months: readonly YearMonth[];
  period: PeriodChoice;
  onChange: (key: PeriodKey) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const first = months.find((month) => month < period.from) ?? period.from;
  const last = months.findLast((month) => month > period.to) ?? period.to;
  const choices = Array.from({ length: monthCount(first, last) }, (_, index) =>
    shiftYearMonth(last, -index),
  );
  const labels = Object.fromEntries(choices.map((month) => [month, monthLabel(month)]));
  const form = useForm({
    defaultValues: { from: period.from, to: period.to },
    validators: { onSubmit: Schema.toStandardSchemaV1(Schema.toType(Fields)) },
    onSubmit: ({ value }) => {
      onChange(periodKey(value.from, value.to));
      setOpen(false);
    },
  });
  return (
    <Popover
      open={open}
      onOpenChange={(value) => {
        if (value) form.reset({ from: period.from, to: period.to });
        setOpen(value);
      }}
    >
      <PopoverTrigger render={<Button variant="ghost" size="sm" className="shrink-0 text-slate" />}>
        <CalendarRange aria-hidden />
        <span className="max-sm:sr-only">Choose months</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            form.handleSubmit().catch(reportError);
          }}
        >
          <PopoverTitle className="font-[560]">Choose months</PopoverTitle>
          <div className="flex flex-wrap gap-3">
            {(["from", "to"] as const).map((name) => (
              <form.Field key={name} name={name}>
                {(field) => (
                  <div className="w-40 space-y-2">
                    <Label htmlFor={`${id}-${name}`}>{name === "from" ? "From" : "Through"}</Label>
                    <Select
                      items={labels}
                      value={field.state.value}
                      onValueChange={(value) => {
                        if (value) field.handleChange(value);
                      }}
                    >
                      <SelectTrigger
                        id={`${id}-${name}`}
                        className="w-full"
                        aria-invalid={field.state.meta.errors.length > 0}
                        aria-describedby={`${id}-${name}-error`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {choices.map((month) => (
                          <SelectItem key={month} value={month}>
                            {labels[month]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldError id={`${id}-${name}-error`} errors={field.state.meta.errors} />
                  </div>
                )}
              </form.Field>
            ))}
          </div>
          <Button type="submit">Show these months</Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

import {
  OverviewInput,
  type Account,
  PeriodSelection,
  Period,
  CalendarDate,
} from "@repo/contracts/finance";
import { useForm } from "@tanstack/react-form";
import { Schema, DateTime } from "effect";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";

export function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="space-y-2">
      <Label className="flex-col items-start">
        {label}
        <Select
          items={options}
          value={value}
          onValueChange={(next) => {
            const option = options.find((item) => item.value === next);
            if (option) onChange(option.value);
          }}
        >
          <SelectTrigger aria-label={label} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Label>
    </div>
  );
}
export function PeriodFields({
  value,
  onChange,
}: {
  value: PeriodSelection;
  onChange: (value: PeriodSelection) => void;
}) {
  return (
    <div className="space-y-3">
      <Choice
        label="Period"
        value={value.kind}
        options={[
          { value: "calendar", label: "Calendar period" },
          { value: "rolling", label: "Rolling days" },
          { value: "fixed", label: "Fixed dates" },
        ]}
        onChange={(kind) =>
          onChange(
            kind === "calendar"
              ? { kind, unit: "month", count: 1, offset: 0, alignment: "elapsed" }
              : kind === "rolling"
                ? { kind, days: 30 }
                : { ...defaultFixed, kind },
          )
        }
      />
      {value.kind === "calendar" && (
        <div className="grid gap-3 xl:grid-cols-2">
          <Choice
            label="Unit"
            value={value.unit}
            options={[
              { value: "week", label: "Week" },
              { value: "month", label: "Month" },
              { value: "quarter", label: "Quarter" },
              { value: "year", label: "Year" },
            ]}
            onChange={(unit) => onChange({ ...value, unit })}
          />
          <Choice
            label="Alignment"
            value={value.alignment}
            options={[
              { value: "elapsed", label: "Elapsed days" },
              { value: "full", label: "Full period" },
            ]}
            onChange={(alignment) => onChange({ ...value, alignment })}
          />
          <Label className="flex-col items-start">
            Number of periods
            <Input
              type="number"
              min={1}
              max={3660}
              value={value.count}
              onChange={(event) => onChange({ ...value, count: Number(event.target.value) })}
            />
          </Label>
          <Label className="flex-col items-start">
            Periods ago
            <Input
              type="number"
              min={0}
              max={120}
              value={-value.offset}
              onChange={(event) => onChange({ ...value, offset: -Number(event.target.value) })}
            />
          </Label>
        </div>
      )}
      {value.kind === "rolling" && (
        <Label className="flex-col items-start">
          Days
          <Input
            type="number"
            min={1}
            max={3660}
            value={value.days}
            onChange={(event) => onChange({ ...value, days: Number(event.target.value) })}
          />
        </Label>
      )}
      {value.kind === "fixed" && (
        <div className="grid gap-3 xl:grid-cols-2">
          <Label className="flex-col items-start">
            Start
            <Input
              type="date"
              value={value.start}
              onChange={(event) => {
                const result = Schema.decodeOption(PeriodSelection)({
                  ...value,
                  start: event.target.value,
                });
                if (result._tag === "Some") onChange(result.value);
              }}
            />
          </Label>
          <Label className="flex-col items-start">
            End, excluded
            <Input
              type="date"
              value={value.endExclusive}
              onChange={(event) => {
                const result = Schema.decodeOption(PeriodSelection)({
                  ...value,
                  endExclusive: event.target.value,
                });
                if (result._tag === "Some") onChange(result.value);
              }}
            />
          </Label>
        </div>
      )}
    </div>
  );
}
const defaultFixed = {
  start: CalendarDate.make(
    DateTime.formatIsoDateUtc(DateTime.startOf(DateTime.nowUnsafe(), "month")),
  ),
  endExclusive: CalendarDate.make(
    DateTime.formatIsoDateUtc(
      DateTime.add(DateTime.startOf(DateTime.nowUnsafe(), "month"), { months: 1 }),
    ),
  ),
} satisfies Period;
export const defaultOverview: OverviewInput = {
  period: { kind: "calendar", unit: "month", count: 1, offset: 0, alignment: "elapsed" },
  basis: "spending",
  currency: "AUD",
  accounts: [],
};
export function OverviewSelection({
  input,
  accounts,
  onApply,
  postedOnly = false,
}: {
  postedOnly?: boolean;
  input: OverviewInput;
  accounts: readonly Account[];
  onApply: (input: OverviewInput) => Promise<void>;
}) {
  const form = useForm({
    defaultValues: input,
    validators: { onSubmit: Schema.toStandardSchemaV1(Schema.toType(OverviewInput)) },
    onSubmit: ({ value }) => onApply(value),
  });
  return (
    <form
      className="rounded-lg border bg-card p-5"
      onSubmit={(event) => {
        event.preventDefault();
        form.handleSubmit().catch(reportError);
      }}
    >
      <div className="grid gap-5 md:grid-cols-3">
        <form.Field name="period">
          {(field) => <PeriodFields value={field.state.value} onChange={field.handleChange} />}
        </form.Field>
        <div className="space-y-4">
          <form.Field name="basis">
            {(field) => (
              <Choice
                label="Date basis"
                value={field.state.value}
                options={[
                  ...(!postedOnly ? [{ value: "spending" as const, label: "Spending" }] : []),
                  { value: "posted", label: "Posted" },
                ]}
                onChange={field.handleChange}
              />
            )}
          </form.Field>
          <form.Field name="currency">
            {(field) => (
              <Label className="flex-col items-start">
                Currency
                <Input
                  value={field.state.value}
                  maxLength={3}
                  onChange={(event) => field.handleChange(event.target.value.toUpperCase())}
                />
              </Label>
            )}
          </form.Field>
        </div>
        <form.Field name="accounts">
          {(field) => (
            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-medium">
                Accounts, none selected means all
              </legend>
              {accounts.map((account) => (
                <Label key={account.id} className="flex items-center gap-2">
                  <Checkbox
                    aria-label={account.label}
                    checked={field.state.value.includes(account.id)}
                    onCheckedChange={(checked) =>
                      field.handleChange(
                        checked
                          ? [...field.state.value, account.id]
                          : field.state.value.filter((id) => id !== account.id),
                      )
                    }
                  />
                  {account.label} ({account.currency})
                </Label>
              ))}
            </fieldset>
          )}
        </form.Field>
      </div>
      <form.Subscribe selector={(state) => state.errors}>
        {(errors) => <FieldError errors={errors} />}
      </form.Subscribe>
      <Button className="mt-5" type="submit">
        Apply period
      </Button>
    </form>
  );
}

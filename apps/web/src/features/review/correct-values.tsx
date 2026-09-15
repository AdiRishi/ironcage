import { CalendarDate, type Candidate, type ReviewObservation } from "@repo/contracts/finance";
import { formatDecimal, parseMoney } from "@repo/finance";
import { useForm } from "@tanstack/react-form";
import { Effect, Schema } from "effect";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const Fields = Schema.Struct({
  postedOn: CalendarDate,
  valueOn: Schema.String,
  currency: Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/)),
  amount: Schema.String,
  description: Schema.NonEmptyString,
  balance: Schema.String,
});
const fields = [
  { name: "postedOn", label: "Booked date", type: "date" },
  { name: "valueOn", label: "Value date, if shown", type: "date" },
  { name: "amount", label: "Signed booked amount", type: "text" },
  { name: "currency", label: "Currency", type: "text" },
  { name: "description", label: "Description", type: "text" },
  { name: "balance", label: "Running balance, if shown", type: "text" },
] as const;
export function CorrectValues({
  row,
  disabled,
  onSubmit,
}: {
  row: typeof ReviewObservation.Type;
  disabled: boolean;
  onSubmit: (candidate: Candidate) => void;
}) {
  const candidate = row.candidate ?? row.acceptedCandidate;
  const [error, setError] = useState<string>();
  const form = useForm({
    defaultValues: {
      postedOn: candidate?.postedOn ?? "",
      valueOn: candidate?.valueOn ?? "",
      currency: candidate?.amount.currency ?? "AUD",
      amount: candidate ? formatDecimal(candidate.amount) : "",
      description: candidate?.description ?? "",
      balance: candidate?.balance ? formatDecimal(candidate.balance) : "",
    },
    validators: { onSubmit: Schema.toStandardSchemaV1(Fields) },
    onSubmit: async ({ value }) => {
      setError(undefined);
      await Effect.gen(function* () {
        const postedOn = yield* Schema.decodeEffect(CalendarDate)(value.postedOn);
        const valueOn = value.valueOn
          ? yield* Schema.decodeEffect(CalendarDate)(value.valueOn)
          : null;
        const amount = yield* parseMoney(value.amount, value.currency);
        const balance = value.balance ? yield* parseMoney(value.balance, value.currency) : null;
        onSubmit({
          postedOn,
          valueOn,
          amount,
          balance,
          description: value.description,
          bankId: candidate?.bankId ?? null,
          originalMoney: candidate?.originalMoney ?? null,
        });
      })
        .pipe(Effect.runPromise)
        .catch((cause: unknown) =>
          setError(cause instanceof Error ? cause.message : "Check the values against the source."),
        );
    },
  });
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        form.handleSubmit().catch(reportError);
      }}
    >
      <fieldset disabled={disabled} className="grid gap-4 sm:grid-cols-2">
        {fields.map(({ name, label, type }) => (
          <form.Field key={name} name={name}>
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor={`${row.id}-${name}`}>{label}</Label>
                <Input
                  id={`${row.id}-${name}`}
                  type={type}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                <FieldError errors={field.state.meta.errors} />
              </div>
            )}
          </form.Field>
        ))}
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={disabled}>
        Accept these values
      </Button>
    </form>
  );
}

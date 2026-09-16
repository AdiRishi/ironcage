import { Period } from "@repo/contracts/finance";
import { useForm } from "@tanstack/react-form";
import { Effect, Schema } from "effect";

import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ComparisonPeriod({
  period,
  onApply,
}: {
  period: Period;
  onApply: (period: Period) => Promise<void>;
}) {
  const defaults: typeof Period.Encoded = period;
  const form = useForm({
    defaultValues: defaults,
    validators: { onSubmit: Schema.toStandardSchemaV1(Period) },
    onSubmit: async ({ value }) =>
      onApply(await Effect.runPromise(Schema.decodeEffect(Period)(value))),
  });
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        form.handleSubmit().catch(reportError);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {(["start", "endExclusive"] as const).map((name) => (
          <form.Field key={name} name={name}>
            {(field) => (
              <Label className="flex-col items-start">
                {name === "start" ? "Comparison start" : "Comparison end, excluded"}
                <Input
                  type="date"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Label>
            )}
          </form.Field>
        ))}
      </div>
      <form.Subscribe selector={(state) => state.errors}>
        {(errors) => <FieldError errors={errors} />}
      </form.Subscribe>
      <Button variant="outline" type="submit">
        Apply comparison dates
      </Button>
    </form>
  );
}

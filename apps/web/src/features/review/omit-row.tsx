import { useForm } from "@tanstack/react-form";
import { Schema } from "effect";
import { useId } from "react";

import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const Fields = Schema.Struct({ reason: Schema.Trim.check(Schema.isMinLength(1)) });
export function OmitRow({
  disabled,
  onSubmit,
}: {
  disabled: boolean;
  onSubmit: (reason: string) => void;
}) {
  const id = useId();
  const form = useForm({
    defaultValues: { reason: "" },
    validators: { onSubmit: Schema.toStandardSchemaV1(Fields) },
    onSubmit: ({ value }) => onSubmit(value.reason),
  });
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        form.handleSubmit().catch(reportError);
      }}
    >
      <form.Field name="reason">
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor={id}>Why should this row be left out?</Label>
            <Textarea
              id={id}
              value={field.state.value}
              disabled={disabled}
              required
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            />
            <FieldError errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>
      <p className="type-small text-slate">
        The literal source row and your reason will be retained.
      </p>
      <Button type="submit" disabled={disabled} variant="outline">
        Leave this row out
      </Button>
    </form>
  );
}

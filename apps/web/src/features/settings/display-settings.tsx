import { AppRequestError } from "@repo/contracts/app";
import { CommandId, type Settings, UpdateSettings } from "@repo/contracts/finance";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Schema, Struct } from "effect";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { updateSettings } from "./functions";

const Fields = Schema.Struct(Struct.pick(UpdateSettings.fields, ["timezone", "reportingCurrency"]));
export function DisplaySettings({ settings }: { settings: Settings }) {
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (data: typeof UpdateSettings.Type) => updateSettings({ data }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["settings"] });
    },
  });
  const uncertain =
    mutation.error instanceof AppRequestError && mutation.error.code === "unavailable";
  const form = useForm({
    defaultValues: { timezone: settings.timezone, reportingCurrency: settings.reportingCurrency },
    validators: { onSubmit: Schema.toStandardSchemaV1(Fields) },
    onSubmit: async ({ value }) => {
      await mutation
        .mutateAsync(
          uncertain && mutation.variables
            ? mutation.variables
            : {
                ...value,
                commandId: CommandId.make(crypto.randomUUID()),
                expectedVersion: settings.version,
              },
        )
        .catch(() => undefined);
    },
  });
  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        form.handleSubmit().catch(reportError);
      }}
    >
      <fieldset disabled={mutation.isPending || uncertain} className="grid gap-5 sm:grid-cols-2">
        <form.Field name="timezone">
          {(field) => (
            <div className="space-y-2">
              <Label htmlFor="timezone">Display timezone</Label>
              <Input
                id="timezone"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
                required
                list="timezones"
              />
              <datalist id="timezones">
                {[
                  "Australia/Sydney",
                  "Australia/Melbourne",
                  "Australia/Brisbane",
                  "Australia/Perth",
                  "UTC",
                ].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </datalist>
              {field.state.meta.errors.map((error) => (
                <p key={error?.message} className="text-sm text-destructive">
                  {error?.message}
                </p>
              ))}
            </div>
          )}
        </form.Field>
        <form.Field name="reportingCurrency">
          {(field) => (
            <div className="space-y-2">
              <Label htmlFor="reporting-currency">Reporting currency</Label>
              <Input
                id="reporting-currency"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value.toUpperCase())}
                pattern="[A-Z]{3}"
                maxLength={3}
                required
              />
              <p className="text-sm text-muted-foreground">
                Transactions retain their booked currency.
              </p>
            </div>
          )}
        </form.Field>
      </fieldset>
      {mutation.error && (
        <div role="alert" className="space-y-2 text-sm text-destructive">
          <p>{mutation.error.message}</p>
          {!uncertain && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                mutation.reset();
                client.invalidateQueries({ queryKey: ["settings"] }).catch(reportError);
              }}
            >
              Refresh settings
            </Button>
          )}
        </div>
      )}
      {mutation.isSuccess && <output className="block text-sm">Display settings saved.</output>}
      <Button type="submit" disabled={mutation.isPending}>
        {mutation.isPending ? "Saving…" : uncertain ? "Retry save" : "Save display settings"}
      </Button>
    </form>
  );
}

import {
  CommandId,
  UpdateClassificationSettings,
  type ClassificationSettings,
  type SuggestCategories,
} from "@repo/contracts/finance";
import { formatDecimal, parseMoney } from "@repo/finance";
import { useForm } from "@tanstack/react-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Effect, Schema } from "effect";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCommand } from "@/lib/use-command";

import {
  getClassificationSettings,
  suggestCategories,
  updateClassificationSettings,
} from "./functions";
import { useClassificationRuns } from "./queries";

export function ClassificationSection() {
  const settings = useQuery({
    queryKey: ["classificationSettings"],
    queryFn: () => getClassificationSettings(),
  });
  const runs = useClassificationRuns();
  const client = useQueryClient();
  const request = useCommand({
    mutationFn: (data: typeof SuggestCategories.Type) => suggestCategories({ data }),
    onSuccess: () => client.invalidateQueries(),
  });
  return (
    <section className="space-y-4 rounded-lg border p-5">
      <h2 className="text-xl font-semibold">Category suggestions</h2>
      <p>
        {settings.data?.provider?.name ?? "No provider configured"} ·{" "}
        {settings.data?.enabled ? "Enabled" : "Disabled"}
      </p>
      <p className="text-sm break-words text-muted-foreground">{settings.data?.provider?.model}</p>
      <p className="text-sm text-muted-foreground">
        Sends up to 1,000 characters of each transaction description, its established financial
        role, account kind, known merchant, and the current category tree. Suggestions never change
        bank fields or apply automatically. Manual categorization is always available.
      </p>
      {settings.data && (
        <ClassificationSettingsForm key={settings.data.version} settings={settings.data} />
      )}
      <div className="flex flex-wrap items-center gap-4">
        <Button
          disabled={
            !settings.data?.enabled || !settings.data.provider || request.mutation.isPending
          }
          onClick={() =>
            request.submit({ commandId: CommandId.make(crypto.randomUUID()), eventIds: "all" })
          }
        >
          {request.uncertain
            ? "Retry suggestion request"
            : "Suggest categories for uncategorized events"}
        </Button>
        <Link className="underline" to="/settings/suggestions">
          Review category suggestions
        </Link>
      </div>
      {request.mutation.data && (
        <output>Requested {request.mutation.data.requested} events.</output>
      )}
      {runs.data?.map((run) => (
        <div key={run.id} className="space-y-1 border-t pt-3">
          <p>
            {run.status} · {run.processed} of {run.requested} events
          </p>
          {run.failure && <p role="alert">{run.failure}</p>}
        </div>
      ))}
      {[settings.error, runs.error, request.mutation.error]
        .filter((error) => error !== null)
        .map((error, index) => (
          <p role="alert" key={index}>
            {error.message}
          </p>
        ))}
    </section>
  );
}
function ClassificationSettingsForm({
  settings,
}: {
  settings: typeof ClassificationSettings.Type;
}) {
  const id = useId();
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const command = useCommand({
    mutationFn: async (data: typeof UpdateClassificationSettings.Type) =>
      updateClassificationSettings({
        data: await Effect.runPromise(Schema.encodeEffect(UpdateClassificationSettings)(data)),
      }),
    onSuccess: () => client.invalidateQueries(),
  });
  const form = useForm({
    defaultValues: {
      enabled: settings.enabled,
      warning: settings.warning ? formatDecimal(settings.warning) : "",
    },
    onSubmit: async ({ value }) => {
      const amount = value.warning
        ? await Effect.runPromise(parseMoney(value.warning, "USD").pipe(Effect.result))
        : null;
      if (amount?._tag === "Failure") {
        setError(amount.failure.message);
        return;
      }
      setError(null);
      command.submit({
        commandId: CommandId.make(crypto.randomUUID()),
        enabled: value.enabled,
        warning: amount?.success ?? null,
        expectedVersion: settings.version,
      });
    },
  });
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit().catch(reportError);
      }}
    >
      <fieldset className="space-y-3" disabled={command.mutation.isPending || command.uncertain}>
        <form.Field name="enabled">
          {(field) => (
            <Label>
              <Checkbox
                checked={field.state.value}
                onCheckedChange={(checked) => field.handleChange(checked === true)}
              />
              Enable category model
            </Label>
          )}
        </form.Field>
        <form.Field name="warning">
          {(field) => (
            <div className="max-w-xs space-y-2">
              <Label htmlFor={`${id}-warning`}>Usage warning threshold (USD)</Label>
              <Input
                id={`${id}-warning`}
                inputMode="decimal"
                placeholder="No threshold"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
              />
            </div>
          )}
        </form.Field>
      </fieldset>
      <p className="text-sm text-muted-foreground">
        Blocks new calls once recorded classification cost reaches the threshold. Estimates round up
        to a cent per call. Delayed reports and concurrent calls can exceed it.
      </p>
      <Button variant="outline" type="submit" disabled={command.mutation.isPending}>
        {command.uncertain ? "Retry model settings" : "Save model settings"}
      </Button>
      {error && <p role="alert">{error}</p>}
      {command.mutation.error && <p role="alert">{command.mutation.error.message}</p>}
    </form>
  );
}

import {
  CommandId,
  UpdateEnrichmentSettings,
  type EnrichmentSettings,
  type RequestEnrichment,
} from "@repo/contracts/finance";
import { formatDecimal, parseMoney } from "@repo/finance";
import { useForm } from "@tanstack/react-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Effect, Schema } from "effect";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCommand } from "@/lib/use-command";

import { requestEnrichment, updateEnrichmentSettings } from "./functions";
import { enrichmentSettingsQuery, useEnrichmentRuns } from "./queries";

const runStatusLabels = {
  pending: "Waiting.",
  running: "Running.",
  completed: "Finished.",
  failed: "Stopped.",
} as const;

export function EnrichmentSection() {
  const settings = useQuery(enrichmentSettingsQuery());
  const runs = useEnrichmentRuns();
  const client = useQueryClient();
  const request = useCommand({
    mutationFn: (data: typeof RequestEnrichment.Type) => requestEnrichment({ data }),
    onSuccess: () => client.invalidateQueries(),
  });
  return (
    <section className="space-y-4">
      <h2 className="type-heading">Counterparty identification</h2>
      <p className="type-small text-slate">
        {settings.data?.provider.name} runs {settings.data?.provider.model}. It receives descriptor
        text, payment channels, directions, account kinds, and category names. It never receives
        amounts, balances, dates, or account numbers. Confident answers apply at once; the rest
        become questions.
      </p>
      {settings.data && <SettingsForm key={settings.data.version} settings={settings.data} />}
      <Button
        disabled={!settings.data?.enabled || request.mutation.isPending}
        onClick={() => request.submit({ commandId: CommandId.make(crypto.randomUUID()) })}
      >
        {request.uncertain ? "Retry identification" : "Identify new counterparties"}
      </Button>
      {runs.data && runs.data.length > 0 && (
        <ul className="divide-y divide-rule border-y border-rule type-small">
          {runs.data.slice(0, 5).map((run) => (
            <li key={run.id} className="space-y-0.5 py-2">
              <p>
                <span className="font-[600]">{runStatusLabels[run.status]}</span>{" "}
                {run.resolved.toLocaleString()} of {run.requested.toLocaleString()} names
                identified.
              </p>
              {run.failure && (
                <p role="alert" className="text-attention">
                  {run.failure}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
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

function SettingsForm({ settings }: { settings: typeof EnrichmentSettings.Type }) {
  const id = useId();
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const command = useCommand({
    mutationFn: async (data: typeof UpdateEnrichmentSettings.Type) =>
      updateEnrichmentSettings({
        data: await Effect.runPromise(Schema.encodeEffect(UpdateEnrichmentSettings)(data)),
      }),
    onSuccess: () => client.invalidateQueries(),
  });
  const form = useForm({
    defaultValues: {
      enabled: settings.enabled,
      warning: settings.warning ? formatDecimal(settings.warning) : "",
      threshold: String(Math.round(settings.autoApplyConfidence * 100)),
    },
    onSubmit: async ({ value }) => {
      const amount = value.warning
        ? await Effect.runPromise(parseMoney(value.warning, "USD").pipe(Effect.result))
        : null;
      const threshold = Number(value.threshold) / 100;
      if (amount?._tag === "Failure") return setError(amount.failure.message);
      if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1)
        return setError("Use a threshold from 0 to 100.");
      setError(null);
      command.submit({
        commandId: CommandId.make(crypto.randomUUID()),
        enabled: value.enabled,
        warning: amount?.success ?? null,
        autoApplyConfidence: threshold,
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
              Identify counterparties with the model
            </Label>
          )}
        </form.Field>
        <div className="grid max-w-md gap-3 sm:grid-cols-2">
          <form.Field name="warning">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor={`${id}-warning`}>Usage warning (USD)</Label>
                <Input
                  id={`${id}-warning`}
                  inputMode="decimal"
                  placeholder="No warning"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              </div>
            )}
          </form.Field>
          <form.Field name="threshold">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor={`${id}-threshold`}>Apply automatically from (%)</Label>
                <Input
                  id={`${id}-threshold`}
                  inputMode="numeric"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              </div>
            )}
          </form.Field>
        </div>
      </fieldset>
      <Button variant="outline" type="submit" disabled={command.mutation.isPending}>
        {command.uncertain ? "Retry saving" : "Save identification settings"}
      </Button>
      {error && <p role="alert">{error}</p>}
      {command.mutation.error && <p role="alert">{command.mutation.error.message}</p>}
    </form>
  );
}

import {
  CommandId,
  type EvaluationScore,
  type ModelSettings,
  type RequestEnrichment,
  type RequestEvaluation,
} from "@repo/contracts/finance";
import { useForm, useStore } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { Schema } from "effect";
import { useId } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ModelSettingsSave } from "@/features/models/save";
import { useModelSettingsCommand } from "@/features/models/use-model-settings";
import { useCommand } from "@/lib/use-command";

import { requestEnrichment, requestEvaluation } from "./functions";
import { useEnrichmentRuns } from "./queries";

const runStatusLabels = {
  pending: "Waiting.",
  running: "Running.",
  completed: "Finished.",
  failed: "Stopped.",
} as const;

export function EnrichmentSection({ settings }: { settings: ModelSettings }) {
  const runs = useEnrichmentRuns();
  const client = useQueryClient();
  const request = useCommand({
    mutationFn: (data: typeof RequestEnrichment.Type) => requestEnrichment({ data }),
    onSuccess: () => client.invalidateQueries(),
  });
  const evaluation = useCommand({
    mutationFn: (data: typeof RequestEvaluation.Type) => requestEvaluation({ data }),
    onSuccess: () => client.invalidateQueries(),
  });
  return (
    <section id="identification" aria-labelledby="identification-heading" className="space-y-4">
      <h2 id="identification-heading" className="type-heading">
        Counterparty identification
      </h2>
      <p className="type-small text-slate">
        To identify counterparties, {settings.enrichment.provider.name} runs{" "}
        {settings.enrichment.provider.model}. It receives descriptor text, payment channels,
        directions, account kinds, and category names. It never receives amounts, balances, dates,
        or account numbers. Confident answers apply at once; the rest become questions.
      </p>
      <IdentificationSettings settings={settings} />
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={!settings.enrichment.enabled || request.mutation.isPending}
          onClick={() => request.submit({ commandId: CommandId.make(crypto.randomUUID()) })}
        >
          {request.uncertain ? "Retry identification" : "Identify new counterparties"}
        </Button>
        <Button
          variant="outline"
          disabled={!settings.enrichment.enabled || evaluation.mutation.isPending}
          onClick={() => evaluation.submit({ commandId: CommandId.make(crypto.randomUUID()) })}
        >
          {evaluation.uncertain ? "Retry the check" : "Check the model against your answers"}
        </Button>
      </div>
      <p className="type-small text-slate">
        The check asks the model about every counterparty you set, without showing it your answer,
        and scores what it says. Use it to choose the confidence threshold.
      </p>
      {runs.data && runs.data.length > 0 && (
        <ul className="divide-y divide-rule border-y border-rule type-small">
          {runs.data.slice(0, 5).map((run) => (
            <li key={run.id} className="space-y-0.5 py-2">
              {run.evaluation ? (
                <Evaluation status={run.status} score={run.evaluation} />
              ) : (
                <p>
                  <span className="font-[600]">{runStatusLabels[run.status]}</span>{" "}
                  {run.resolved.toLocaleString()} of {run.requested.toLocaleString()} names
                  identified
                  {run.failed > 0 && `, ${run.failed.toLocaleString()} left for the next run`}.
                </p>
              )}
              {run.failure &&
                (run.status === "failed" ? (
                  <p role="alert" className="text-attention">
                    {run.failure}
                  </p>
                ) : (
                  <p className="text-slate">A batch failed. {run.failure}</p>
                ))}
            </li>
          ))}
        </ul>
      )}
      {[runs.error, request.mutation.error, evaluation.mutation.error]
        .filter((error) => error !== null)
        .map((error, index) => (
          <p role="alert" key={index}>
            {error.message}
          </p>
        ))}
    </section>
  );
}

const percent = (part: number, whole: number) =>
  whole === 0 ? "none" : `${Math.round((part / whole) * 100)}%`;

function Evaluation({
  status,
  score,
}: {
  status: keyof typeof runStatusLabels;
  score: typeof EvaluationScore.Type;
}) {
  return (
    <div className="space-y-1">
      <p>
        <span className="font-[600]">Check against your answers. {runStatusLabels[status]}</span>{" "}
        {score.answered.toLocaleString()} of {score.asked.toLocaleString()} answered. Name{" "}
        {percent(score.name, score.answered)}, category {percent(score.category, score.answered)},
        top-level category {percent(score.topCategory, score.answered)}, kind{" "}
        {percent(score.kind, score.answered)}.
      </p>
      <p className="text-slate">
        At or above {Math.round(score.threshold * 100)}% confidence, {score.confidentRight} of{" "}
        {score.confident} answers were right.{" "}
        {score.bands
          .filter((band) => band.answered > 0)
          .map(
            (band) =>
              `${Math.round(band.from * 100)}–${Math.round(band.to * 100)}%: ${band.right} of ${band.answered} right`,
          )
          .join("; ")}
        .
      </p>
    </div>
  );
}

// The threshold is a whole percentage in the form.
const Fields = Schema.Struct({
  enabled: Schema.Boolean,
  threshold: Schema.String.check(
    Schema.makeFilter(
      (value) =>
        (/^\d{1,3}$/.test(value.trim()) && Number(value) <= 100) ||
        "Enter a whole percentage from 0 to 100.",
    ),
  ),
});
const valuesOf = (settings: ModelSettings) => ({
  enabled: settings.enrichment.enabled,
  threshold: String(Math.round(settings.enrichment.autoApplyConfidence * 100)),
});

function IdentificationSettings({ settings }: { settings: ModelSettings }) {
  const id = useId();
  const form = useForm({
    defaultValues: valuesOf(settings),
    validators: { onSubmit: Schema.toStandardSchemaV1(Fields) },
    onSubmit: ({ value }) =>
      command.save({
        enrichment: { enabled: value.enabled, autoApplyConfidence: Number(value.threshold) / 100 },
      }),
  });
  const touched = useStore(form.store, (state) => state.isTouched);
  const command = useModelSettingsCommand(settings, touched, () =>
    form.reset(form.state.values, { keepDefaultValues: true }),
  );
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        form.handleSubmit().catch(reportError);
      }}
    >
      <fieldset className="space-y-3" disabled={command.mutation.isPending || command.uncertain}>
        <form.Field name="enabled">
          {(field) => (
            <Label>
              <Checkbox
                checked={field.state.value}
                onCheckedChange={(checked) => field.handleChange(checked)}
              />
              Identify counterparties with the model
            </Label>
          )}
        </form.Field>
        <form.Field name="threshold">
          {(field) => (
            <Field className="max-w-xs" data-invalid={field.state.meta.errors.length > 0}>
              <FieldLabel htmlFor={`${id}-threshold`}>Apply automatically from (%)</FieldLabel>
              <Input
                id={`${id}-threshold`}
                inputMode="numeric"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                aria-invalid={field.state.meta.errors.length > 0}
                aria-describedby={`${id}-threshold-error`}
              />
              <FieldError id={`${id}-threshold-error`} errors={field.state.meta.errors} />
            </Field>
          )}
        </form.Field>
      </fieldset>
      <ModelSettingsSave
        command={command}
        now={`identification is ${settings.enrichment.enabled ? "on" : "off"} and applies answers from ${Math.round(settings.enrichment.autoApplyConfidence * 100)}% confidence`}
        saved="Identification settings saved."
        label="Save identification settings"
      />
    </form>
  );
}

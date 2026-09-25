import { type ModelSettings, ModelTask, type ModelUsage } from "@repo/contracts/finance";
import { formatDecimal, formatMoney, parseMoney } from "@repo/finance";
import { useForm, useStore } from "@tanstack/react-form";
import { cn } from "cn";
import { Effect, Schema } from "effect";
import { useId, useState } from "react";

import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { ModelSettingsSave } from "./save";
import { useModelSettingsCommand } from "./use-model-settings";

const taskLabels = {
  enrichment: "Counterparty identification",
  evaluation: "Checks against your answers",
  analyst: "Analyst questions",
  briefing: "Monthly briefings",
} satisfies Record<ModelTask, string>;
// Tasks since retired keep the name they were recorded with.
const taskLabel = (task: string) => (Schema.is(ModelTask)(task) ? taskLabels[task] : task);

const callCount = (count: number) => `${count.toLocaleString()} ${count === 1 ? "call" : "calls"}`;

// A total that no call reported is unknown, never zero.
const tokenText = (tokens: bigint | null) =>
  tokens === null ? "Unknown" : tokens.toLocaleString();
const costText = (costs: (typeof ModelUsage.Type)["costs"]) =>
  costs.length === 0 ? "Unknown" : costs.map(formatMoney).join(", ");

const summary = ({ calls, inputTokens, outputTokens, costs }: typeof ModelUsage.Type) =>
  [
    callCount(calls),
    inputTokens === null ? "input tokens unknown" : `${inputTokens.toLocaleString()} input tokens`,
    outputTokens === null
      ? "output tokens unknown"
      : `${outputTokens.toLocaleString()} output tokens`,
    costs.length === 0 ? "recorded cost unknown" : `recorded cost ${costText(costs)}`,
  ].join(" · ");

const incomplete = (count: number) =>
  `${callCount(count)} ${count === 1 ? "has an incomplete usage report" : "have incomplete usage reports"}, and the totals count only what was reported.`;

const head = "px-0 pl-4 type-small font-normal whitespace-normal text-slate first:pl-0";
const numeric = "px-0 pl-4 text-right tabular";

// What every model call so far used and cost, in total and by task, and the one warning
// that stops new calls of every task once the recorded cost reaches it.
export function ModelUsageSection({
  usage,
  settings,
}: {
  usage: typeof ModelUsage.Type;
  settings: ModelSettings;
}) {
  return (
    <section aria-labelledby="model-usage-heading" className="space-y-4">
      <h2 id="model-usage-heading" className="type-heading">
        Model usage
      </h2>
      <p className="type-small text-slate">
        Counterparty identification and the analyst call a model. Statements are parsed without one,
        and an unreadable page becomes a question.
      </p>
      <p className="tabular">
        {usage.calls === 0 ? "No model calls so far." : `So far: ${summary(usage)}.`}
      </p>
      {usage.unknownUsage > 0 && (
        <p className="type-small text-slate">{incomplete(usage.unknownUsage)}</p>
      )}
      {usage.tasks.length > 0 && (
        <Table className="type-small!">
          <TableCaption className="sr-only">Model usage by task</TableCaption>
          <TableHeader>
            <TableRow className="border-rule hover:bg-transparent">
              <TableHead scope="col" className={head}>
                Task
              </TableHead>
              <TableHead scope="col" className={cn(head, "text-right")}>
                Calls
              </TableHead>
              <TableHead scope="col" className={cn(head, "text-right")}>
                Incomplete reports
              </TableHead>
              <TableHead scope="col" className={cn(head, "text-right")}>
                Input tokens
              </TableHead>
              <TableHead scope="col" className={cn(head, "text-right")}>
                Output tokens
              </TableHead>
              <TableHead scope="col" className={cn(head, "text-right")}>
                Recorded cost
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {usage.tasks.map((row) => (
              <TableRow key={row.task} className="border-rule hover:bg-transparent">
                <TableHead scope="row" className="h-auto px-0 py-2 font-normal whitespace-normal">
                  {taskLabel(row.task)}
                </TableHead>
                <TableCell className={numeric}>{row.calls.toLocaleString()}</TableCell>
                <TableCell className={numeric}>{row.unknownUsage.toLocaleString()}</TableCell>
                <TableCell className={numeric}>{tokenText(row.inputTokens)}</TableCell>
                <TableCell className={numeric}>{tokenText(row.outputTokens)}</TableCell>
                <TableCell className={numeric}>{costText(row.costs)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <UsageWarning settings={settings} />
    </section>
  );
}

const valuesOf = (settings: ModelSettings) => ({
  warning: settings.warning ? formatDecimal(settings.warning) : "",
});

function UsageWarning({ settings }: { settings: ModelSettings }) {
  const id = useId();
  const [invalid, setInvalid] = useState<string | null>(null);
  const form = useForm({
    defaultValues: valuesOf(settings),
    onSubmit: async ({ value }) => {
      const text = value.warning.trim();
      const parsed = text
        ? await Effect.runPromise(parseMoney(text, "USD").pipe(Effect.result))
        : null;
      if (parsed?._tag === "Failure")
        return setInvalid("Enter an amount in US dollars, such as 20.00.");
      setInvalid(null);
      command.save({ warning: parsed?.success ?? null });
    },
  });
  const touched = useStore(form.store, (state) => state.isTouched);
  const command = useModelSettingsCommand(settings, touched, () =>
    form.reset(form.state.values, { keepDefaultValues: true }),
  );
  return (
    <form
      className="max-w-md space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        form.handleSubmit().catch(reportError);
      }}
    >
      <fieldset disabled={command.mutation.isPending || command.uncertain}>
        <form.Field name="warning">
          {(field) => (
            <Field data-invalid={invalid !== null}>
              <FieldLabel htmlFor={`${id}-warning`}>Usage warning (USD)</FieldLabel>
              <Input
                id={`${id}-warning`}
                inputMode="decimal"
                placeholder="No warning"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                aria-invalid={invalid !== null}
                aria-describedby={`${id}-warning-help ${id}-warning-error`}
              />
              <FieldDescription id={`${id}-warning-help`}>
                Once the recorded cost of every task together reaches it, no task calls the model
                until you raise it. Leave it empty for no warning.
              </FieldDescription>
              <FieldError id={`${id}-warning-error`}>{invalid}</FieldError>
            </Field>
          )}
        </form.Field>
      </fieldset>
      <ModelSettingsSave
        command={command}
        now={settings.warning ? `a warning at ${formatMoney(settings.warning)}` : "no warning"}
        saved="Warning saved."
        label="Save warning"
      />
    </form>
  );
}

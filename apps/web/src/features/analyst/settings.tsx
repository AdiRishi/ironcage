import type { ModelSettings } from "@repo/contracts/finance";
import { useForm, useStore } from "@tanstack/react-form";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ModelSettingsSave } from "@/features/models/save";
import { useModelSettingsCommand } from "@/features/models/use-model-settings";

const valuesOf = (settings: ModelSettings) => ({ enabled: settings.analyst.enabled });

// The analyst's switch, with what it sends the model. It is off until you turn it on.
export function AnalystSettings({ settings }: { settings: ModelSettings }) {
  const form = useForm({
    defaultValues: valuesOf(settings),
    onSubmit: ({ value }) => command.save({ analyst: { enabled: value.enabled } }),
  });
  const touched = useStore(form.store, (state) => state.isTouched);
  const command = useModelSettingsCommand(settings, touched, () =>
    form.reset(form.state.values, { keepDefaultValues: true }),
  );
  return (
    <section aria-labelledby="analyst-heading" className="space-y-4">
      <h2 id="analyst-heading" className="type-heading">
        Analyst
      </h2>
      <p className="type-small text-slate">
        The analyst answers questions about your money in plain language, and writes a briefing of
        each month once it ends. {settings.analyst.provider.name} runs{" "}
        {settings.analyst.provider.model}. For each question and each month's briefing, the analyst
        sends the model the figures, dates, bank descriptions, and counterparty, category, tag,
        personal event, and account labels it works from, and the names of your files and any
        problems importing them. The analyst never sends account numbers or balances.
      </p>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          form.handleSubmit().catch(reportError);
        }}
      >
        <fieldset disabled={command.mutation.isPending || command.uncertain}>
          <form.Field name="enabled">
            {(field) => (
              <Label>
                <Checkbox
                  checked={field.state.value}
                  onCheckedChange={(checked) => field.handleChange(checked)}
                />
                Answer questions and write monthly briefings with the model
              </Label>
            )}
          </form.Field>
        </fieldset>
        <ModelSettingsSave
          command={command}
          now={`the analyst is ${settings.analyst.enabled ? "on" : "off"}`}
          saved="Analyst setting saved."
          label="Save analyst setting"
        />
      </form>
    </section>
  );
}

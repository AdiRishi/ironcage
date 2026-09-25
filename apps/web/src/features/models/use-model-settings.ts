import { CommandId, type ModelSettings, UpdateModelSettings } from "@repo/contracts/finance";
import { useQueryClient } from "@tanstack/react-query";
import { Effect, Schema } from "effect";
import { useState } from "react";

import { AppRequestError } from "@/lib/app-error";
import { useCommand } from "@/lib/use-command";
import { useFocusRequest } from "@/lib/use-focus-request";

import { updateModelSettings } from "./functions";
import { modelSettingsQuery } from "./queries";

type Part = Partial<Pick<typeof UpdateModelSettings.Type, "enrichment" | "analyst" | "warning">>;

// Each part of the model settings has its own form. A save sends the other parts as the
// baseline holds them and expects the baseline's version, so it cannot undo a change
// you were not shown. Until you edit the form, the baseline follows the settings.
//
// `onSaved` makes the form untouched and keeps what it shows. TanStack Form sets an
// untouched form to its defaults whenever they change, and the form's defaults come
// from `settings`, which is older than the save until the saved settings reach it.
export function useModelSettingsCommand(
  settings: ModelSettings,
  touched: boolean,
  onSaved: () => void,
) {
  const [baseline, setBaseline] = useState(settings);
  if (!touched && settings.version > baseline.version) setBaseline(settings);
  const client = useQueryClient();
  const [saveRef, requestSave] = useFocusRequest<HTMLButtonElement>();
  const { mutation, submit, uncertain } = useCommand({
    mutationFn: async (data: typeof UpdateModelSettings.Type) =>
      updateModelSettings({
        data: await Effect.runPromise(Schema.encodeEffect(UpdateModelSettings)(data)),
      }),
    onSuccess: async (saved) => {
      client.setQueryData(modelSettingsQuery().queryKey, saved);
      setBaseline(saved);
      onSaved();
      await client.invalidateQueries();
    },
  });
  return {
    mutation,
    uncertain,
    // The form's Save button, which takes focus after Keep my edits removes itself.
    saveRef,
    stale: mutation.error instanceof AppRequestError && mutation.error.code === "stale",
    canKeepEdits: settings.version !== baseline.version,
    keepEdits: () => {
      requestSave();
      setBaseline(settings);
      mutation.reset();
    },
    save: (part: Part) =>
      submit({
        commandId: CommandId.make(crypto.randomUUID()),
        enrichment: {
          enabled: baseline.enrichment.enabled,
          autoApplyConfidence: baseline.enrichment.autoApplyConfidence,
        },
        analyst: { enabled: baseline.analyst.enabled },
        warning: baseline.warning,
        ...part,
        expectedVersion: baseline.version,
      }),
  };
}

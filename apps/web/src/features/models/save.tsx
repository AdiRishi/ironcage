import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

import type { useModelSettingsCommand } from "./use-model-settings";

// The end of a model settings form: why it did not save, or that it did, and its Save
// button. When the settings changed since you started editing, it says what they are
// now and lets you save your edits over them.
export function ModelSettingsSave({
  command: { mutation, uncertain, stale, canKeepEdits, keepEdits, saveRef },
  now,
  saved,
  label,
}: {
  command: ReturnType<typeof useModelSettingsCommand>;
  now: string;
  saved: string;
  label: string;
}) {
  return (
    <>
      {mutation.error && (
        <Alert variant="destructive">
          <AlertDescription>{mutation.error.message}</AlertDescription>
          {stale && (
            <>
              <AlertDescription>Now: {now}. Your edits are still in the form.</AlertDescription>
              <div className="mt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!canKeepEdits}
                  onClick={keepEdits}
                >
                  Keep my edits
                </Button>
              </div>
            </>
          )}
        </Alert>
      )}
      {mutation.isSuccess && <output className="block type-small">{saved}</output>}
      <Button ref={saveRef} type="submit" variant="outline" disabled={mutation.isPending}>
        {mutation.isPending ? "Saving…" : uncertain ? "Retry save" : label}
      </Button>
    </>
  );
}

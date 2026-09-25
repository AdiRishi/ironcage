import type {
  ApplyCounterpartyChange,
  CounterpartyChange,
  CounterpartyChangeOutcome,
} from "@repo/contracts/finance";

import { usePreviewedCommand } from "@/lib/use-previewed-command";

import { applyCounterpartyChange, previewCounterpartyChange } from "./functions";

// Previews a counterparty change, then applies the change as previewed, with the
// versions it was previewed at.
export function useCounterpartyChange(
  onApplied?: (outcome: typeof CounterpartyChangeOutcome.Type) => void | Promise<void>,
) {
  return usePreviewedCommand({
    preview: (change: CounterpartyChange) => previewCounterpartyChange({ data: { change } }),
    apply: (data: typeof ApplyCounterpartyChange.Type) => applyCounterpartyChange({ data }),
    command: ({ previewed, commandId }) => ({ commandId, change: previewed.change }),
    onApplied,
  });
}

import type {
  Correction,
  CounterpartyChangeEntry,
  CounterpartyUndoOutcome,
  EventHistory,
  PreviewCounterpartyUndo,
  PreviewUndoCorrection,
  ReferenceData,
  UndoCorrection,
  UndoCounterpartyChange,
} from "@repo/contracts/finance";
import { useRef, useState } from "react";

import { ChangeDialog } from "@/components/change-dialog";
import { Button } from "@/components/ui/button";
import { ChangePreview } from "@/features/counterparties/change-preview";
import {
  previewCounterpartyUndo,
  undoCounterpartyChange,
} from "@/features/counterparties/functions";
import { previewUndoCorrection, undoCorrection } from "@/features/events/functions";
import { EventOutcome } from "@/features/events/outcome";
import { instantLabel } from "@/lib/time";
import { useFocusRequest } from "@/lib/use-focus-request";
import { usePreviewedCommand } from "@/lib/use-previewed-command";

import { describeCorrection, describeCounterpartyChange, scopeLabel } from "./describe";

export type UndoneHandler = (outcome: typeof CounterpartyUndoOutcome.Type) => void | Promise<void>;

// A correction names counterparties from its history's `names`, and a counterparty
// change from its own subjects.
export type HistoryItem =
  | {
      kind: "correction";
      correction: typeof Correction.Type;
      names: (typeof EventHistory.Type)["names"];
    }
  | { kind: "counterparty"; change: typeof CounterpartyChangeEntry.Type };

// One change in a history: what it did, when, which transactions it reached, and an
// undo while it can still be undone. Undoing a counterparty change replaces Undo with
// its status, which then takes focus.
export function HistoryEntry({
  entry,
  references,
  timeZone,
  onUndone,
}: {
  entry: HistoryItem;
  references: typeof ReferenceData.Type;
  timeZone: string;
  onUndone?: UndoneHandler;
}) {
  const [statusRef, requestStatus] = useFocusRequest<HTMLParagraphElement>();
  const lines =
    entry.kind === "correction"
      ? describeCorrection(entry.correction, entry.names, references.categories)
      : describeCounterpartyChange(entry.change, references.categories);
  const createdAt =
    entry.kind === "correction" ? entry.correction.createdAt : entry.change.createdAt;
  const changed =
    entry.kind === "counterparty" && entry.change.eventCount > 0
      ? `, ${entry.change.eventCount} ${entry.change.eventCount === 1 ? "transaction" : "transactions"} changed`
      : "";
  return (
    <article className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-3">
      <div className="min-w-0 flex-1 space-y-0.5">
        {lines.map((line) => (
          <p key={line}>{line}.</p>
        ))}
        <p className="type-small text-slate">
          <time dateTime={createdAt}>{instantLabel(createdAt, timeZone)}</time> ·{" "}
          {scopeLabel(entry)}
          {changed}
        </p>
      </div>
      {entry.kind === "correction" ? (
        <UndoCorrectionDialog
          correction={entry.correction}
          summary={lines.join(". ")}
          references={references}
        />
      ) : entry.change.undoable ? (
        <UndoChangeDialog
          change={entry.change}
          summary={lines.join(". ")}
          onUndone={async (outcome) => {
            requestStatus();
            await onUndone?.(outcome);
          }}
        />
      ) : (
        <p ref={statusRef} tabIndex={-1} className="type-small text-slate">
          {entry.change.undone ? "Undone" : "Changed again later"}
        </p>
      )}
    </article>
  );
}

function UndoChangeDialog({
  change,
  summary,
  onUndone,
}: {
  change: typeof CounterpartyChangeEntry.Type;
  summary: string;
  onUndone: UndoneHandler;
}) {
  const [open, setOpen] = useState(false);
  // The trigger leaves once the history shows the change undone, so focus is not
  // returned to it.
  const undone = useRef(false);
  const undo = usePreviewedCommand({
    preview: (data: typeof PreviewCounterpartyUndo.Type) => previewCounterpartyUndo({ data }),
    apply: (data: typeof UndoCounterpartyChange.Type) => undoCounterpartyChange({ data }),
    command: ({ request, commandId }) => ({ commandId, changeId: request.changeId }),
    onApplied: async (outcome) => {
      undone.current = true;
      setOpen(false);
      await onUndone(outcome);
    },
  });
  return (
    <ChangeDialog
      open={open}
      onOpenChange={(value) => {
        if (value && !undo.pending && !undo.uncertain) {
          undo.reset();
          undo.preview({ changeId: change.id });
        }
        setOpen(value);
      }}
      trigger={
        <Button variant="outline" size="sm">
          Undo<span className="sr-only"> {summary}</span>
        </Button>
      }
      title="Undo this change?"
      description={`${summary}.`}
      change={undo}
      confirmLabel="Undo the change"
      finalFocus={() => !undone.current}
    >
      {undo.previewed && (
        <ChangePreview eventCount={undo.previewed.eventCount} impacts={undo.previewed.impacts} />
      )}
    </ChangeDialog>
  );
}

function UndoCorrectionDialog({
  correction,
  summary,
  references,
}: {
  correction: typeof Correction.Type;
  summary: string;
  references: typeof ReferenceData.Type;
}) {
  const [open, setOpen] = useState(false);
  const undo = usePreviewedCommand({
    preview: (data: typeof PreviewUndoCorrection.Type) => previewUndoCorrection({ data }),
    apply: (data: typeof UndoCorrection.Type) => undoCorrection({ data }),
    command: ({ previewed, request, commandId }) => ({
      commandId,
      correctionId: request.correctionId,
      expectedVersions: previewed.expectedVersions,
    }),
    onApplied: () => setOpen(false),
  });
  return (
    <ChangeDialog
      open={open}
      onOpenChange={(value) => {
        if (value && !undo.pending && !undo.uncertain) {
          undo.reset();
          undo.preview({ correctionId: correction.id });
        }
        setOpen(value);
      }}
      trigger={
        <Button variant="outline" size="sm">
          Undo<span className="sr-only"> {summary}</span>
        </Button>
      }
      title="Undo this change?"
      description={`${summary}.`}
      change={undo}
      confirmLabel="Undo the change"
    >
      {undo.previewed && (
        <>
          <EventOutcome event={undo.previewed.after} references={references} />
          <ChangePreview eventCount={1} impacts={undo.previewed.impacts} />
        </>
      )}
    </ChangeDialog>
  );
}

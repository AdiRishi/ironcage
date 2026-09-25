import type { Counterparty, ReferenceData } from "@repo/contracts/finance";
import { useNavigate } from "@tanstack/react-router";
import { useId, useState } from "react";

import { ChangeDialog } from "@/components/change-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";

import { ChangePreview } from "./change-preview";
import { CounterpartyCombobox, type CounterpartyChoice } from "./counterparty-combobox";
import { useCounterpartyChange } from "./use-counterparty-change";

// Joins a counterparty into the one it duplicates and opens that one. History keeps
// everything the merge replaced, so it can be undone.
export function Merge({
  counterparty,
  references,
}: {
  counterparty: Counterparty;
  references: typeof ReferenceData.Type;
}) {
  const id = useId();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [targetId, setTargetId] = useState<CounterpartyChoice["id"] | null>(null);
  const target = references.counterparties.find((item) => item.id === targetId) ?? null;
  const change = useCounterpartyChange(async (outcome) => {
    setOpen(false);
    await navigate({
      to: "/counterparties/$counterpartyId",
      params: { counterpartyId: outcome.counterparty.id },
    });
  });
  const merge = (into: CounterpartyChoice) =>
    change.preview({
      kind: "merge",
      sourceId: counterparty.id,
      sourceVersion: counterparty.version,
      targetId: into.id,
      targetVersion: into.version,
    });
  return (
    <ChangeDialog
      open={open}
      onOpenChange={(value) => {
        if (value && !change.pending && !change.uncertain) {
          setTargetId(null);
          change.reset();
        }
        setOpen(value);
      }}
      trigger={
        <Button variant="link" className="h-auto px-0 text-slate">
          This is the same as another counterparty
        </Button>
      }
      title={`Merge ${counterparty.name}`}
      description={`Its descriptors, the transactions you moved to it by hand, and the rules that name it move to the counterparty you choose, and ${counterparty.name} is removed. Where both have a default for the same reference, the other counterparty's stays. You can undo a merge from History.`}
      change={change}
      confirmLabel={target ? `Merge into ${target.name}` : "Merge"}
      recovery={
        change.stale &&
        target && (
          <Button size="sm" variant="outline" onClick={() => merge(target)}>
            Preview again
          </Button>
        )
      }
    >
      <Field>
        <FieldLabel htmlFor={`${id}-target`}>Merge into</FieldLabel>
        <CounterpartyCombobox
          id={`${id}-target`}
          counterparties={references.counterparties}
          excluding={counterparty.id}
          value={targetId}
          onValueChange={(next) => {
            setTargetId(next?.id ?? null);
            if (next) merge(next);
            else change.reset();
          }}
          disabled={change.pending || change.uncertain}
        />
      </Field>
      {change.previewed && (
        <ChangePreview
          eventCount={change.previewed.eventCount}
          impacts={change.previewed.impacts}
        />
      )}
    </ChangeDialog>
  );
}

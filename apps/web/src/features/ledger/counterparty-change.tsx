import type {
  AssignEventCounterparty,
  FinancialEvent,
  PostingDetail,
  PreviewEventCounterparty,
  ReferenceData,
} from "@repo/contracts/finance";
import { Schema } from "effect";
import { useId, useState } from "react";

import { ChangeDialog } from "@/components/change-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ChangePreview } from "@/features/counterparties/change-preview";
import {
  CounterpartyCombobox,
  type CounterpartyChoice,
} from "@/features/counterparties/counterparty-combobox";
import { useCounterpartyChange } from "@/features/counterparties/use-counterparty-change";
import { assignEventCounterparty, previewEventCounterparty } from "@/features/events/functions";
import { EventOutcome } from "@/features/events/outcome";
import { usePreviewedCommand } from "@/lib/use-previewed-command";

type Descriptor = NonNullable<(typeof PostingDetail.Type)["descriptor"]>;
// A counterparty you choose, or the one the bank's description names.
type Target = { kind: "counterparty"; counterparty: CounterpartyChoice } | { kind: "bank" };
const Scope = Schema.Literals(["one", "every"]);
type Scope = typeof Scope.Type;

// Moves a transaction to another counterparty. When the bank writes other transactions
// the same way, it asks whether only this one moves or the descriptor moves with all of
// them.
export function CounterpartyChange({
  event,
  descriptor,
  references,
}: {
  event: FinancialEvent;
  descriptor: Descriptor | null;
  references: typeof ReferenceData.Type;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<Target | null>(null);
  const [scope, setScope] = useState<Scope | null>(null);
  const shared = descriptor !== null && descriptor.eventCount > 1;
  const written = descriptor ? (descriptor.counterpartyText ?? descriptor.aliasKey) : "";
  const close = () => setOpen(false);
  const assign = usePreviewedCommand({
    preview: (data: typeof PreviewEventCounterparty.Type) => previewEventCounterparty({ data }),
    apply: (data: typeof AssignEventCounterparty.Type) => assignEventCounterparty({ data }),
    command: ({ previewed, request, commandId }) => ({
      commandId,
      ...request,
      expectedVersions: previewed.expectedVersions,
    }),
    onApplied: close,
  });
  const move = useCounterpartyChange(close);
  const everything = scope === "every" && target?.kind === "counterparty";
  const active = everything ? move : assign;
  const choose = (next: Target | null, nextScope: Scope | null) => {
    setTarget(next);
    setScope(nextScope);
    assign.reset();
    move.reset();
    if (next?.kind === "bank") assign.preview({ eventId: event.id, counterpartyId: null });
    else if (next && descriptor && shared && nextScope === "every")
      move.preview({
        kind: "moveAlias",
        aliasKey: descriptor.aliasKey,
        expectedVersion: descriptor.aliasVersion,
        counterpartyId: next.counterparty.id,
        event: { eventId: event.id, version: event.version },
      });
    else if (next && (!shared || nextScope === "one"))
      assign.preview({ eventId: event.id, counterpartyId: next.counterparty.id });
  };
  const busy = assign.pending || assign.uncertain || move.pending || move.uncertain;
  const moving = everything ? (move.previewed?.eventCount ?? 0) : 0;
  return (
    <ChangeDialog
      open={open}
      onOpenChange={(value) => {
        if (value && !busy) choose(null, null);
        setOpen(value);
      }}
      trigger={
        <Button variant="link" size="xs" className="h-auto px-0">
          Change<span className="sr-only"> the counterparty</span>
        </Button>
      }
      title="Change the counterparty"
      change={active}
      confirmLabel={
        target === null
          ? "Move"
          : target.kind === "bank"
            ? "Follow the bank's description"
            : moving > 1
              ? `Move all ${moving} to ${target.counterparty.name}`
              : `Move to ${target.counterparty.name}`
      }
      recovery={
        active.stale &&
        target && (
          <Button size="sm" variant="outline" onClick={() => choose(target, scope)}>
            Preview again
          </Button>
        )
      }
    >
      <Field>
        <FieldLabel htmlFor={`${id}-target`}>Who it was with</FieldLabel>
        <CounterpartyCombobox
          id={`${id}-target`}
          counterparties={references.counterparties}
          excluding={event.counterpartyId}
          value={target?.kind === "counterparty" ? target.counterparty.id : null}
          onValueChange={(next) =>
            choose(next ? { kind: "counterparty", counterparty: next } : null, scope)
          }
          disabled={busy}
        />
      </Field>
      {event.counterpartySource === "user" && (
        <Button
          variant="outline"
          className="justify-self-start"
          disabled={busy}
          aria-pressed={target?.kind === "bank"}
          onClick={() => choose({ kind: "bank" }, null)}
        >
          Follow the bank's description
        </Button>
      )}
      {shared && target?.kind === "counterparty" && (
        <div className="space-y-3">
          <p id={`${id}-scope`} className="font-[560]">
            Which transactions move
          </p>
          <RadioGroup
            aria-labelledby={`${id}-scope`}
            value={scope}
            onValueChange={(next) => {
              if (Schema.is(Scope)(next)) choose(target, next);
            }}
            disabled={busy}
          >
            <label className="flex items-start gap-3">
              <RadioGroupItem value="one" className="mt-0.5" />
              <span>Only this one</span>
            </label>
            <label className="flex items-start gap-3">
              <RadioGroupItem value="every" className="mt-0.5" />
              <span>
                Every transaction written as {written} ({descriptor.eventCount})
              </span>
            </label>
          </RadioGroup>
        </div>
      )}
      {!everything && assign.previewed && (
        <>
          <EventOutcome event={assign.previewed.after} references={references} />
          <ChangePreview eventCount={1} impacts={assign.previewed.impacts} />
        </>
      )}
      {everything && move.previewed && (
        <>
          {move.previewed.event && (
            <EventOutcome event={move.previewed.event} references={references} />
          )}
          <ChangePreview eventCount={move.previewed.eventCount} impacts={move.previewed.impacts} />
        </>
      )}
    </ChangeDialog>
  );
}

import type {
  Counterparty,
  CounterpartyAlias,
  CounterpartyDetail,
  ReferenceData,
} from "@repo/contracts/finance";
import { type RefObject, useId, useRef, useState } from "react";

import { ChangeDialog } from "@/components/change-dialog";
import { ProvenanceMark } from "@/components/provenance";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";

import { ChangePreview } from "./change-preview";
import { CounterpartyCombobox, type CounterpartyChoice } from "./counterparty-combobox";
import { Merge } from "./merge";
import { TakeDescriptor } from "./take-descriptor";
import { useCounterpartyChange } from "./use-counterparty-change";

const transactions = (count: number) => `${count} ${count === 1 ? "transaction" : "transactions"}`;

// The descriptors that resolve to a counterparty. One that belongs to someone else moves
// to them, one of someone else's can be taken, and a duplicate counterparty merges away.
export function Descriptors({
  detail: { counterparty, aliases },
  references,
}: {
  detail: typeof CounterpartyDetail.Type;
  references: typeof ReferenceData.Type;
}) {
  // A moved descriptor leaves the list with the control that moved it, so focus goes
  // to the heading instead.
  const heading = useRef<HTMLHeadingElement>(null);
  return (
    <section aria-labelledby="descriptors-heading" className="space-y-4 border-t border-rule pt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 ref={heading} id="descriptors-heading" tabIndex={-1} className="type-heading">
          How the bank writes it
        </h2>
        <TakeDescriptor counterparty={counterparty} />
      </div>
      {aliases.length === 0 ? (
        <p className="text-slate">
          No descriptor resolves to {counterparty.name}. Take one the bank uses for it.
        </p>
      ) : (
        <ul className="divide-y divide-rule border-y border-rule">
          {aliases.map((alias) => (
            <li
              key={alias.aliasKey}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3"
            >
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="break-words">{alias.samples[0] ?? alias.aliasKey}</span>
                  <ProvenanceMark
                    assignedBy={alias.source === "user" ? "you" : "model"}
                    question={alias.status === "proposed"}
                  />
                </span>
                {alias.samples.length > 1 && (
                  <span className="block type-small break-words text-slate">
                    Also {alias.samples.slice(1).join(", ")}
                  </span>
                )}
                <span className="block type-small text-slate">
                  {transactions(alias.eventCount)}
                </span>
              </span>
              <MoveDescriptor
                alias={alias}
                counterparty={counterparty}
                references={references}
                heading={heading}
              />
            </li>
          ))}
        </ul>
      )}
      <Merge counterparty={counterparty} references={references} />
    </section>
  );
}

// Moves a descriptor that names the wrong counterparty, with every transaction the bank
// writes that way.
function MoveDescriptor({
  alias,
  counterparty,
  references,
  heading,
}: {
  alias: typeof CounterpartyAlias.Type;
  counterparty: Counterparty;
  references: typeof ReferenceData.Type;
  heading: RefObject<HTMLHeadingElement | null>;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<CounterpartyChoice | null>(null);
  const moved = useRef(false);
  const change = useCounterpartyChange(() => {
    moved.current = true;
    setOpen(false);
  });
  const text = alias.samples[0] ?? alias.aliasKey;
  const move = (to: CounterpartyChoice) =>
    change.preview({
      kind: "moveAlias",
      aliasKey: alias.aliasKey,
      expectedVersion: alias.version,
      counterpartyId: to.id,
      event: null,
    });
  return (
    <ChangeDialog
      open={open}
      onOpenChange={(value) => {
        if (value && !change.pending && !change.uncertain) {
          setTarget(null);
          change.reset();
        }
        setOpen(value);
      }}
      trigger={
        <Button variant="outline" size="sm">
          Move to…<span className="sr-only"> {text}</span>
        </Button>
      }
      title="Move a descriptor"
      finalFocus={() => (moved.current ? heading.current : true)}
      description={`Every transaction the bank writes as “${text}” moves with it: ${transactions(alias.eventCount)}.`}
      change={change}
      confirmLabel={target ? `Move to ${target.name}` : "Move"}
      recovery={
        change.stale &&
        target && (
          <Button size="sm" variant="outline" onClick={() => move(target)}>
            Preview again
          </Button>
        )
      }
    >
      <Field>
        <FieldLabel htmlFor={`${id}-target`}>Move it to</FieldLabel>
        <CounterpartyCombobox
          id={`${id}-target`}
          counterparties={references.counterparties}
          excluding={counterparty.id}
          value={target?.id ?? null}
          onValueChange={(next) => {
            setTarget(next);
            if (next) move(next);
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

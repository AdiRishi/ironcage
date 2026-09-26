import type { Counterparty, DescriptorMatch } from "@repo/contracts/finance";
import { useQuery } from "@tanstack/react-query";
import { useDeferredValue, useId, useState } from "react";

import { ChangeDialog } from "@/components/change-dialog";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
} from "@/components/ui/combobox";
import { Field, FieldLabel } from "@/components/ui/field";

import { ChangePreview } from "./change-preview";
import { descriptorSearchQuery } from "./queries";
import { useCounterpartyChange } from "./use-counterparty-change";

type Match = typeof DescriptorMatch.Type;
type Group = { value: string; items: readonly Match[] };

// An alias that is not applied names no counterparty, whatever the model proposed.
const held = (match: Match) => match.alias?.status === "applied";

function holder(match: Match) {
  if (!match.alias) return "Not identified yet";
  return held(match)
    ? `Now resolves to ${match.alias.counterpartyName}`
    : `The model suggests ${match.alias.counterpartyName}`;
}

const label = (match: Match) => match.samples[0] ?? match.aliasKey;
const transactions = (count: number) => `${count} ${count === 1 ? "transaction" : "transactions"}`;

// Finds a descriptor by the text the bank printed, or by who it resolves to now, and
// moves it to this counterparty with every transaction the bank writes that way.
export function TakeDescriptor({ counterparty }: { counterparty: Counterparty }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [chosen, setChosen] = useState<Match | null>(null);
  const search = useDeferredValue(text.trim());
  const matches = useQuery({
    ...descriptorSearchQuery({ search, excludeCounterpartyId: counterparty.id }),
    enabled: open && search !== "",
  });
  const change = useCounterpartyChange(() => setOpen(false));
  // The chosen descriptor as the latest search reads it, so a stale reply shows who
  // holds it now.
  const current = matches.data?.find((match) => match.aliasKey === chosen?.aliasKey) ?? chosen;
  const found = search === "" ? [] : (matches.data ?? []);
  const groups = [
    { value: "Other counterparties", items: found.filter(held) },
    { value: "Not identified", items: found.filter((match) => !held(match)) },
  ].filter((group) => group.items.length > 0);
  const take = (match: Match) =>
    change.preview({
      kind: "moveAlias",
      aliasKey: match.aliasKey,
      expectedVersion: match.alias?.version ?? null,
      counterpartyId: counterparty.id,
      event: null,
    });
  return (
    <ChangeDialog
      open={open}
      onOpenChange={(value) => {
        if (value && !change.pending && !change.uncertain) {
          setText("");
          setChosen(null);
          change.reset();
        }
        setOpen(value);
      }}
      trigger={
        <Button variant="outline" size="sm">
          Take a descriptor
        </Button>
      }
      title="Take a descriptor"
      description={`Every transaction the bank writes with it moves to ${counterparty.name}.`}
      change={change}
      confirmLabel={`Take it for ${counterparty.name}`}
      recovery={
        change.stale &&
        current && (
          <Button size="sm" variant="outline" onClick={() => take(current)}>
            Preview again
          </Button>
        )
      }
    >
      <Field>
        <FieldLabel htmlFor={`${id}-search`}>Find what the bank printed</FieldLabel>
        <Combobox
          items={groups}
          filter={null}
          inputValue={text}
          onInputValueChange={setText}
          value={current}
          onValueChange={(next) => {
            setChosen(next);
            if (next) take(next);
            else change.reset();
          }}
          itemToStringLabel={label}
          isItemEqualToValue={(item, other) => item.aliasKey === other.aliasKey}
          disabled={change.pending || change.uncertain}
        >
          {/* The registry's chevron is a nameless button in the tab order. Typing, the arrow
              keys, and a click on the input open the list without it. */}
          <ComboboxInput
            id={`${id}-search`}
            placeholder="Such as WOOLWORTHS or 5678"
            className="w-full"
            showTrigger={false}
          />
          <ComboboxContent>
            <ComboboxEmpty>
              {search === "" ? "Type part of the description." : "No descriptor matches."}
            </ComboboxEmpty>
            <ComboboxList>
              {(group: Group) => (
                <ComboboxGroup key={group.value} items={group.items}>
                  <ComboboxLabel>{group.value}</ComboboxLabel>
                  <ComboboxCollection>
                    {(match: Match) => (
                      <ComboboxItem key={match.aliasKey} value={match} className="items-start">
                        <span className="min-w-0 flex-1">
                          <span className="block break-words">{label(match)}</span>
                          <span className="block type-small text-slate">
                            {holder(match)} · {transactions(match.eventCount)}
                          </span>
                        </span>
                      </ComboboxItem>
                    )}
                  </ComboboxCollection>
                </ComboboxGroup>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      </Field>
      {current && (
        <div className="space-y-1 rounded-lg border border-rule bg-sheet p-3">
          <p className="font-[560] break-words">{label(current)}</p>
          {current.samples.length > 1 && (
            <p className="type-small break-words text-slate">
              Also {current.samples.slice(1).join(", ")}
            </p>
          )}
          <p className="type-small text-slate">
            {holder(current)} · {transactions(current.eventCount)}
          </p>
        </div>
      )}
      {change.previewed && (
        <ChangePreview
          eventCount={change.previewed.eventCount}
          impacts={change.previewed.impacts}
        />
      )}
    </ChangeDialog>
  );
}

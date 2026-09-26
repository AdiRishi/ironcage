import type { CounterpartyId, ReferenceData } from "@repo/contracts/finance";
import { useMemo, useState } from "react";

import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";

import { kindLabels } from "./choices";

export type CounterpartyChoice = (typeof ReferenceData.Type)["counterparties"][number];
// A counterparty you have, or a name to create one with.
type Option = CounterpartyChoice | { create: string };

const optionLabel = (option: Option) => ("create" in option ? option.create : option.name);
const sameOption = (option: Option, other: Option) =>
  "create" in option
    ? "create" in other && option.create === other.create
    : !("create" in other) && option.id === other.id;
const sameName = (name: string, other: string) =>
  name.localeCompare(other, undefined, { sensitivity: "accent" }) === 0;

// Finds a counterparty by name. `excluding` leaves out the one being changed, which
// cannot be its own target. With `create`, typed text that names no counterparty is
// offered as a new one, `create.name` is the name chosen that way, and a name you already
// have is only offered as that counterparty, so answering never duplicates one.
//
// The combobox rewrites its text to the selected option's label whenever the selection is a
// different object, so the selection keeps its identity from render to render.
export function CounterpartyCombobox({
  id,
  counterparties,
  excluding,
  value,
  onValueChange,
  create,
  disabled,
}: {
  id: string;
  counterparties: readonly CounterpartyChoice[];
  excluding: typeof CounterpartyId.Type | null;
  value: typeof CounterpartyId.Type | null;
  onValueChange: (counterparty: CounterpartyChoice | null) => void;
  create?: { name: string | null; onCreate: (name: string) => void };
  disabled?: boolean;
}) {
  const choices = counterparties.filter((item) => item.id !== excluding);
  const created = create?.name ?? null;
  const named = useMemo(() => (created === null ? null : { create: created }), [created]);
  const selected: Option | null = named ?? choices.find((item) => item.id === value) ?? null;
  const [text, setText] = useState(selected ? optionLabel(selected) : "");
  const typed = text.trim();
  const offered = create && typed !== "" && !choices.some((item) => sameName(item.name, typed));
  return (
    <Combobox
      items={offered ? [...choices, { create: typed }] : choices}
      value={selected}
      onValueChange={(next: Option | null) => {
        if (next && "create" in next) create?.onCreate(next.create);
        else onValueChange(next);
      }}
      onInputValueChange={setText}
      itemToStringLabel={optionLabel}
      isItemEqualToValue={sameOption}
      disabled={disabled ?? false}
      limit={50}
    >
      {/* The registry's chevron is a nameless button in the tab order. Typing, the arrow
          keys, and a click on the input open the list without it. */}
      <ComboboxInput
        id={id}
        placeholder={create ? "Search, or type a new name" : "Search by name"}
        className="w-full"
        showTrigger={false}
      />
      <ComboboxContent>
        <ComboboxEmpty>No counterparty has that name.</ComboboxEmpty>
        <ComboboxList>
          {(option: Option) =>
            "create" in option ? (
              <ComboboxItem key="new" value={option}>
                Create “{option.create}”
              </ComboboxItem>
            ) : (
              <ComboboxItem key={option.id} value={option}>
                <span className="min-w-0 flex-1 truncate">{option.name}</span>
                <span className="type-small text-slate">{kindLabels[option.kind]}</span>
              </ComboboxItem>
            )
          }
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

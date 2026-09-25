import type { CounterpartyId, ReferenceData } from "@repo/contracts/finance";

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

// Finds a counterparty by name. `excluding` leaves out the one being changed, which
// cannot be its own target.
export function CounterpartyCombobox({
  id,
  counterparties,
  excluding,
  value,
  onValueChange,
  disabled,
}: {
  id: string;
  counterparties: readonly CounterpartyChoice[];
  excluding: typeof CounterpartyId.Type | null;
  value: typeof CounterpartyId.Type | null;
  onValueChange: (counterparty: CounterpartyChoice | null) => void;
  disabled?: boolean;
}) {
  const choices = counterparties.filter((item) => item.id !== excluding);
  return (
    <Combobox
      items={choices}
      value={choices.find((item) => item.id === value) ?? null}
      onValueChange={onValueChange}
      itemToStringLabel={(item) => item.name}
      isItemEqualToValue={(item, other) => item.id === other.id}
      disabled={disabled ?? false}
      limit={50}
    >
      <ComboboxInput id={id} placeholder="Search by name" className="w-full" />
      <ComboboxContent>
        <ComboboxEmpty>No counterparty has that name.</ComboboxEmpty>
        <ComboboxList>
          {(item: CounterpartyChoice) => (
            <ComboboxItem key={item.id} value={item}>
              <span className="min-w-0 flex-1 truncate">{item.name}</span>
              <span className="type-small text-slate">{kindLabels[item.kind]}</span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

import type { CounterpartyKind, CounterpartyRole } from "@repo/contracts/finance";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { counterpartyKinds } from "./choices";

// What a counterparty is, as every form that sets one asks it.
export function KindSelect({
  id,
  value,
  onValueChange,
  className,
}: {
  id: string;
  value: CounterpartyKind;
  onValueChange: (kind: CounterpartyKind) => void;
  className?: string;
}) {
  return (
    <Select
      items={counterpartyKinds}
      value={value}
      onValueChange={(kind) => {
        if (kind) onValueChange(kind);
      }}
    >
      <SelectTrigger id={id} className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {counterpartyKinds.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// What money with a counterparty is, from `roles`. `none` labels the choice of no role,
// such as "Decide from each payment", and is null where a role is required.
export function RoleSelect<Role extends typeof CounterpartyRole.Type>({
  id,
  roles,
  none,
  value,
  onValueChange,
  invalid,
  className,
}: {
  id: string;
  roles: readonly { value: Role; label: string }[];
  none: string | null;
  value: Role | null;
  onValueChange: (role: Role | null) => void;
  invalid?: boolean;
  className?: string;
}) {
  const items = none === null ? roles : [{ value: null, label: none }, ...roles];
  return (
    <Select items={items} value={value} onValueChange={onValueChange}>
      <SelectTrigger id={id} className={className} aria-invalid={invalid}>
        <SelectValue placeholder="Choose what they are" />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value ?? "none"} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

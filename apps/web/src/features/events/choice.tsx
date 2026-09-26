import { useId } from "react";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function ReferenceChoice<T extends string>({
  label,
  value,
  options,
  onChange,
  emptyLabel = "None",
}: {
  label: string;
  value: T | null;
  options: ReadonlyArray<{ id: T; name: string }>;
  onChange: (value: T | null) => void;
  // What choosing nothing means, such as "All categories" in a filter.
  emptyLabel?: string;
}) {
  const id = useId();
  const items = [
    { value: "", label: emptyLabel },
    ...options.map((option) => ({ value: option.id, label: option.name })),
  ];
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select
        items={items}
        value={value ?? ""}
        onValueChange={(selected) => {
          const option = options.find((item) => item.id === selected);
          onChange(option?.id ?? null);
        }}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

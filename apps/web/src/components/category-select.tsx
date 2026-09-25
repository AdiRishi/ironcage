import type { CategoryId, CategoryTree, ReferenceData } from "@repo/contracts/finance";
import { cn } from "cn";
import type { Ref } from "react";

type Categories = (typeof ReferenceData.Type)["categories"];

// Two levels as option groups; a top-level category is also a choice on its own.
export function CategorySelect({
  categories,
  tree,
  value,
  onChange,
  id,
  className,
  disabled,
  ref,
}: {
  categories: Categories;
  tree: CategoryTree;
  value: typeof CategoryId.Type | null;
  onChange: (value: typeof CategoryId.Type | null) => void;
  id?: string;
  className?: string;
  disabled?: boolean;
  ref?: Ref<HTMLSelectElement>;
}) {
  const active = categories.filter((category) => !category.archived && category.tree === tree);
  const tops = active.filter((category) => category.parentId === null);
  return (
    <select
      ref={ref}
      id={id}
      disabled={disabled}
      value={value ?? ""}
      onChange={(event) => {
        const next = active.find((category) => category.id === event.target.value);
        onChange(next?.id ?? null);
      }}
      className={cn(
        "h-9 rounded-md border border-input bg-sheet px-2.5 text-intaglio disabled:opacity-50",
        className,
      )}
    >
      <option value="">No category</option>
      {tops.map((top) => {
        const children = active.filter((category) => category.parentId === top.id);
        return children.length === 0 ? (
          <option key={top.id} value={top.id}>
            {top.name}
          </option>
        ) : (
          <optgroup key={top.id} label={top.name}>
            <option value={top.id}>{top.name}, general</option>
            {children.map((child) => (
              <option key={child.id} value={child.id}>
                {child.name}
              </option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}

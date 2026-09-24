import type { CategoryId, ReferenceData } from "@repo/contracts/finance";

import { Button } from "@/components/ui/button";
import { categoryColor } from "@/lib/category-colors";

type Category = (typeof ReferenceData.Type)["categories"][number];
type Props = {
  categories: readonly Category[];
  parentId?: typeof CategoryId.Type | null;
  onEdit: (category: Category) => void;
  onDelete: (category: Category) => void;
  disabled: boolean;
};

export function CategoryTree({ categories, parentId = null, onEdit, onDelete, disabled }: Props) {
  const children = categories.filter((category) => category.parentId === parentId);
  if (children.length === 0) return null;
  return (
    <ul
      className={
        parentId
          ? "mb-1 ml-5 border-l border-rule pl-4"
          : "divide-y divide-rule border-y border-rule"
      }
    >
      {children.map((category) => (
        <li key={category.id} className={parentId ? "" : "py-1"}>
          <div className="flex items-center justify-between gap-3 py-1.5">
            <span className="flex min-w-0 items-center gap-2">
              {!parentId && (
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-[3px]"
                  style={{ background: categoryColor(category.slug) }}
                />
              )}
              <span className={parentId ? "truncate" : "truncate font-[600]"}>{category.name}</span>
              {category.archived && <span className="type-small text-slate">Archived</span>}
            </span>
            <span className="flex shrink-0 gap-1">
              <Button variant="ghost" size="sm" onClick={() => onEdit(category)}>
                Edit<span className="sr-only"> {category.name}</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={() => onDelete(category)}
              >
                Delete<span className="sr-only"> {category.name}</span>
              </Button>
            </span>
          </div>
          <CategoryTree
            categories={categories}
            parentId={category.id}
            onEdit={onEdit}
            onDelete={onDelete}
            disabled={disabled}
          />
        </li>
      ))}
    </ul>
  );
}

import type { CategoryId, ReferenceData } from "@repo/contracts/finance";

import { Button } from "@/components/ui/button";

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
    <ul className={parentId ? "ml-4 border-l pl-3" : "rounded-lg border border-rule bg-sheet p-3"}>
      {children.map((category) => (
        <li key={category.id}>
          <div className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="font-medium">
              {category.name}
              {category.archived && " · Archived"}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onEdit(category)}>
                Edit {category.name}
              </Button>
              <Button variant="ghost" disabled={disabled} onClick={() => onDelete(category)}>
                Delete {category.name}
              </Button>
            </div>
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

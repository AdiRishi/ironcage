import type { ReferenceData } from "@repo/contracts/finance";

// The names the reference data holds, by ID. A record merged or deleted since has none.
export const namesOf = (references: typeof ReferenceData.Type) => {
  const lookup = <Id extends string>(rows: ReadonlyArray<{ id: Id; name: string }>) => {
    const names = new Map(rows.map((row) => [row.id, row.name]));
    return (id: Id) => names.get(id);
  };
  return {
    category: lookup(references.categories),
    counterparty: lookup(references.counterparties),
    tag: lookup(references.tags),
    personalEvent: lookup(references.personalEvents),
  };
};
export type Names = ReturnType<typeof namesOf>;

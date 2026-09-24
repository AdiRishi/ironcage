import {
  CommandId,
  type Counterparty,
  type CounterpartyReference,
  type CounterpartyRole,
  type DeleteReferenceDefault,
  type ReferenceData,
  type SaveReferenceDefault,
} from "@repo/contracts/finance";
import { useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";

import { CategorySelect } from "@/components/category-select";
import { Button } from "@/components/ui/button";
import { useCommand } from "@/lib/use-command";

import { counterpartyRoles } from "./choices";
import { deleteReferenceDefault, saveReferenceDefault } from "./functions";

// Payments with one counterparty grouped by what their references say. A default for a
// reference outranks the counterparty's own, so rent and a bill split to the same person
// can mean different things.
export function ReferenceDefaults({
  counterparty,
  rows,
  references,
}: {
  counterparty: Counterparty;
  rows: readonly (typeof CounterpartyReference.Type)[];
  references: typeof ReferenceData.Type;
}) {
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="by-reference-heading" className="space-y-4 border-t border-rule pt-8">
      <div>
        <h2 id="by-reference-heading" className="type-heading">
          By reference
        </h2>
        <p className="mt-1 type-small text-slate">
          What payments mean when their reference says so. Anything not set here follows the
          defaults above.
        </p>
      </div>
      <ul className="divide-y divide-rule border-y border-rule">
        {rows.map((row) => (
          <ReferenceRow
            key={row.referenceKey}
            counterparty={counterparty}
            row={row}
            references={references}
          />
        ))}
      </ul>
    </section>
  );
}

function ReferenceRow({
  counterparty,
  row,
  references,
}: {
  counterparty: Counterparty;
  row: typeof CounterpartyReference.Type;
  references: typeof ReferenceData.Type;
}) {
  const id = useId();
  const client = useQueryClient();
  const [role, setRole] = useState<typeof CounterpartyRole.Type | "">(row.defaultRole ?? "");
  const [categoryId, setCategoryId] = useState(row.defaultCategoryId);
  const save = useCommand({
    mutationFn: (data: typeof SaveReferenceDefault.Type) => saveReferenceDefault({ data }),
    onSuccess: () => client.invalidateQueries(),
  });
  const clear = useCommand({
    mutationFn: (data: typeof DeleteReferenceDefault.Type) => deleteReferenceDefault({ data }),
    onSuccess: () => client.invalidateQueries(),
  });
  const busy = save.mutation.isPending || clear.mutation.isPending;
  const error = save.mutation.error ?? clear.mutation.error;
  return (
    <li className="grid gap-3 py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
      <div className="min-w-0">
        <p className="truncate">“{row.sample}”</p>
        <p className="type-small text-slate">
          {row.eventCount} {row.eventCount === 1 ? "payment" : "payments"}
        </p>
      </div>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (role)
            save.submit({
              commandId: CommandId.make(crypto.randomUUID()),
              counterpartyId: counterparty.id,
              referenceKey: row.referenceKey,
              defaultRole: role,
              defaultCategoryId: categoryId,
            });
        }}
      >
        <label className="grid gap-1" htmlFor={`${id}-role`}>
          <span className="type-small text-slate">These payments are</span>
          <select
            id={`${id}-role`}
            value={role}
            disabled={busy}
            onChange={(event) =>
              setRole(
                counterpartyRoles.find((item) => item.value === event.target.value)?.value ?? "",
              )
            }
            className="h-9 rounded-md border border-input bg-sheet px-2.5"
          >
            <option value="">As the defaults say</option>
            {counterpartyRoles.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1" htmlFor={`${id}-category`}>
          <span className="type-small text-slate">Category</span>
          <CategorySelect
            id={`${id}-category`}
            categories={references.categories}
            tree={role === "income" ? "income" : "spending"}
            value={categoryId}
            onChange={setCategoryId}
            disabled={busy || !role}
          />
        </label>
        <Button type="submit" size="sm" disabled={busy || !role}>
          {save.uncertain ? "Retry" : "Save"}
        </Button>
        {row.defaultRole && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              clear.submit({
                commandId: CommandId.make(crypto.randomUUID()),
                counterpartyId: counterparty.id,
                referenceKey: row.referenceKey,
              })
            }
          >
            {clear.uncertain ? "Retry" : "Clear"}
          </Button>
        )}
      </form>
      {error && (
        <p role="alert" className="type-small text-attention md:col-span-2">
          {error.message}
        </p>
      )}
    </li>
  );
}

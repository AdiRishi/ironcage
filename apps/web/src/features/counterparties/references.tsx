import type {
  Counterparty,
  CounterpartyChange,
  CounterpartyReference,
  ReferenceData,
} from "@repo/contracts/finance";
import { useForm, useStore } from "@tanstack/react-form";
import { useId } from "react";

import { CategorySelect, categoryForRole, roleTree } from "@/components/category-select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { useFocusRequest } from "@/lib/use-focus-request";

import { ChangePreview } from "./change-preview";
import { rolesFor } from "./choices";
import { RoleSelect } from "./fields";
import { useCounterpartyChange } from "./use-counterparty-change";

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
  // The preview's buttons come and go, and the form is disabled while a change is worked
  // out, so focus moves to Apply when a preview arrives and back to Preview after it.
  const [submitRef, requestSubmit] = useFocusRequest<HTMLButtonElement>();
  const [applyRef, requestApply] = useFocusRequest<HTMLButtonElement>();
  const change = useCounterpartyChange();
  const preview = (next: CounterpartyChange) => {
    requestApply();
    change.preview(next);
  };
  const form = useForm({
    defaultValues: { defaultRole: row.defaultRole, defaultCategoryId: row.defaultCategoryId },
    listeners: { onChange: () => change.reset() },
    onSubmit: ({ value: { defaultRole, defaultCategoryId } }) => {
      if (defaultRole)
        preview({
          kind: "saveReference",
          counterpartyId: counterparty.id,
          referenceKey: row.referenceKey,
          expectedVersion: row.version,
          defaultRole,
          defaultCategoryId: defaultRole === "transfer" ? null : defaultCategoryId,
        });
    },
  });
  const role = useStore(form.store, (state) => state.values.defaultRole);
  const previewed = change.previewed;
  const saved = row.version;
  const payments = `${row.eventCount} ${row.eventCount === 1 ? "payment" : "payments"}`;
  return (
    <li className="space-y-3 py-3">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div className="min-w-0">
          <p className="truncate">“{row.sample}”</p>
          <p className="type-small text-slate">{payments}</p>
        </div>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            form.handleSubmit().catch(reportError);
          }}
        >
          <fieldset disabled={change.pending || change.uncertain} className="contents">
            <form.Field
              name="defaultRole"
              listeners={{
                onChange: ({ value }) => {
                  form.setFieldValue("defaultCategoryId", (categoryId) =>
                    categoryForRole(references.categories, value, categoryId),
                  );
                },
              }}
            >
              {(field) => (
                <Field className="w-auto gap-1">
                  <FieldLabel htmlFor={`${id}-role`} className="type-small text-slate">
                    These payments are
                  </FieldLabel>
                  <RoleSelect
                    id={`${id}-role`}
                    roles={rolesFor(counterparty.kind)}
                    none="As the defaults say"
                    value={field.state.value}
                    onValueChange={field.handleChange}
                  />
                </Field>
              )}
            </form.Field>
            <form.Field name="defaultCategoryId">
              {(field) => (
                <Field className="w-auto gap-1">
                  <FieldLabel htmlFor={`${id}-category`} className="type-small text-slate">
                    Category
                  </FieldLabel>
                  <CategorySelect
                    id={`${id}-category`}
                    categories={references.categories}
                    tree={roleTree(role)}
                    value={field.state.value}
                    onChange={field.handleChange}
                    disabled={!role || role === "transfer"}
                  />
                </Field>
              )}
            </form.Field>
            <Button ref={submitRef} type="submit" size="sm" disabled={!role}>
              {change.previewing ? "Calculating…" : "Preview"}
            </Button>
            {saved !== null && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() =>
                  preview({
                    kind: "deleteReference",
                    counterpartyId: counterparty.id,
                    referenceKey: row.referenceKey,
                    expectedVersion: saved,
                  })
                }
              >
                Clear
              </Button>
            )}
          </fieldset>
        </form>
      </div>
      {change.error && (
        <Alert variant="destructive">
          <AlertDescription>{change.error.message}</AlertDescription>
        </Alert>
      )}
      {previewed && (
        <div className="space-y-3">
          <ChangePreview eventCount={previewed.eventCount} impacts={previewed.impacts} />
          <div className="flex flex-wrap gap-2">
            <Button
              ref={applyRef}
              size="sm"
              disabled={change.pending}
              focusableWhenDisabled
              onClick={() => {
                requestSubmit();
                change.confirm();
              }}
            >
              {change.pending
                ? "Saving…"
                : change.uncertain
                  ? "Retry"
                  : previewed.change.kind === "deleteReference"
                    ? `Clear the default for ${payments}`
                    : `Apply to ${payments}`}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={change.pending || change.uncertain}
              onClick={() => {
                requestSubmit();
                change.reset();
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

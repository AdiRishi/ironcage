import { type Counterparty, CounterpartyFields, type ReferenceData } from "@repo/contracts/finance";
import { takesDefaultRole } from "@repo/finance";
import { useForm, useStore } from "@tanstack/react-form";
import { Schema } from "effect";
import { useId, useState } from "react";

import { CategorySelect } from "@/components/category-select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFocusRequest } from "@/lib/use-focus-request";

import { ChangePreview } from "./change-preview";
import { counterpartyKinds, counterpartyRoles, kindLabels } from "./choices";
import { useCounterpartyChange } from "./use-counterparty-change";

// The form edits a brand as text, empty for none, and trims both names on save.
const Values = Schema.Struct({
  ...CounterpartyFields.fields,
  name: Schema.String.check(
    Schema.isMaxLength(120),
    Schema.makeFilter((name) => name.trim() !== "" || "Enter a name."),
  ),
  brand: Schema.String.check(Schema.isMaxLength(120)),
});
const valuesOf = (counterparty: Counterparty) => ({
  name: counterparty.name,
  kind: counterparty.kind,
  brand: counterparty.brand ?? "",
  defaultCategoryId: counterparty.defaultCategoryId,
  defaultRole: counterparty.defaultRole,
});
const kinds = Object.fromEntries(counterpartyKinds.map((kind) => [kind.value, kind.label]));
const roles = {
  "": "Decide from each payment",
  ...Object.fromEntries(counterpartyRoles.map((role) => [role.value, role.label])),
};

// What a counterparty is and what its transactions mean by default. Saving previews how
// many transactions change and which totals move, then applies it to all of them.
export function Defaults({
  counterparty,
  references,
}: {
  counterparty: Counterparty;
  references: typeof ReferenceData.Type;
}) {
  const id = useId();
  // Preview and apply swap places, and fields are disabled while a change is worked out,
  // so focus is moved to whichever of the two is shown next.
  const [submitRef, requestSubmit] = useFocusRequest<HTMLButtonElement>();
  const [applyRef, requestApply] = useFocusRequest<HTMLButtonElement>();
  // The record your edits started from, whose version a save expects. Until you edit,
  // the form follows the counterparty as it changes.
  const [baseline, setBaseline] = useState(counterparty);
  const form = useForm({
    defaultValues: valuesOf(counterparty),
    validators: { onSubmit: Schema.toStandardSchemaV1(Schema.toType(Values)) },
    listeners: { onChange: () => change.reset() },
    onSubmit: ({ value }) => {
      requestApply();
      change.preview({
        kind: "update",
        counterpartyId: baseline.id,
        expectedVersion: baseline.version,
        fields: {
          name: value.name.trim(),
          kind: value.kind,
          brand: value.brand.trim() || null,
          defaultRole: takesDefaultRole(value.kind) ? value.defaultRole : null,
          defaultCategoryId: value.kind === "ownAccount" ? null : value.defaultCategoryId,
        },
      });
    },
  });
  // After a save the form is untouched again, so it follows the record the save left.
  const change = useCounterpartyChange(() => form.reset());
  const touched = useStore(form.store, (state) => state.isTouched);
  if (!touched && baseline !== counterparty) setBaseline(counterparty);
  const kind = useStore(form.store, (state) => state.values.kind);
  const role = useStore(form.store, (state) => state.values.defaultRole);
  const confirmed = baseline.source === "user" && baseline.status === "applied";
  const previewed = change.previewed;
  const category = references.categories.find((item) => item.id === counterparty.defaultCategoryId);
  return (
    <section aria-labelledby="defaults-heading" className="space-y-4 border-t border-rule pt-8">
      <div>
        <h2 id="defaults-heading" className="type-heading">
          What it is
        </h2>
        <p className="mt-1 type-small text-slate">
          Every transaction with {counterparty.name} follows this, except ones you changed by hand.
        </p>
      </div>
      <form
        className="max-w-xl space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          form.handleSubmit().catch(reportError);
        }}
      >
        <fieldset disabled={change.pending || change.uncertain}>
          <FieldGroup className="gap-5">
            <form.Field name="name">
              {(field) => (
                <Field data-invalid={field.state.meta.errors.length > 0}>
                  <FieldLabel htmlFor={`${id}-name`}>Name</FieldLabel>
                  <Input
                    id={`${id}-name`}
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                    maxLength={120}
                    aria-invalid={field.state.meta.errors.length > 0}
                    aria-describedby={`${id}-name-error`}
                  />
                  <FieldError id={`${id}-name-error`} errors={field.state.meta.errors} />
                </Field>
              )}
            </form.Field>
            <form.Field name="kind">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor={`${id}-kind`}>Who they are</FieldLabel>
                  <Select
                    items={kinds}
                    value={field.state.value}
                    onValueChange={(value) => {
                      const next = counterpartyKinds.find((item) => item.value === value);
                      if (next) field.handleChange(next.value);
                    }}
                  >
                    <SelectTrigger id={`${id}-kind`} className="w-full">
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
                </Field>
              )}
            </form.Field>
            <form.Field name="brand">
              {(field) => (
                <Field data-invalid={field.state.meta.errors.length > 0}>
                  <FieldLabel htmlFor={`${id}-brand`}>Part of</FieldLabel>
                  <Input
                    id={`${id}-brand`}
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder="A brand or group, such as Woolworths Group"
                    maxLength={120}
                    aria-invalid={field.state.meta.errors.length > 0}
                    aria-describedby={`${id}-brand-error`}
                  />
                  <FieldError id={`${id}-brand-error`} errors={field.state.meta.errors} />
                </Field>
              )}
            </form.Field>
            {takesDefaultRole(kind) && (
              <form.Field name="defaultRole">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor={`${id}-role`}>Money to or from them is</FieldLabel>
                    <Select
                      items={roles}
                      value={field.state.value ?? ""}
                      onValueChange={(value) => {
                        field.handleChange(
                          counterpartyRoles.find((item) => item.value === value)?.value ?? null,
                        );
                      }}
                    >
                      <SelectTrigger id={`${id}-role`} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(roles).map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              </form.Field>
            )}
            {kind !== "ownAccount" && (
              <form.Field name="defaultCategoryId">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor={`${id}-category`}>Usual category</FieldLabel>
                    <CategorySelect
                      id={`${id}-category`}
                      categories={references.categories}
                      tree={role === "income" ? "income" : "spending"}
                      value={field.state.value}
                      onChange={field.handleChange}
                    />
                  </Field>
                )}
              </form.Field>
            )}
          </FieldGroup>
        </fieldset>
        {change.error && (
          <Alert variant="destructive">
            <AlertDescription>{change.error.message}</AlertDescription>
            {change.stale && (
              <>
                <AlertDescription>
                  Now: {counterparty.name}, {kindLabels[counterparty.kind].toLowerCase()},{" "}
                  {category ? `usually ${category.name}` : "no usual category"}. Your edits are
                  still in the form.
                </AlertDescription>
                <div className="mt-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={counterparty.version === baseline.version}
                    onClick={() => {
                      requestSubmit();
                      setBaseline(counterparty);
                      change.reset();
                    }}
                  >
                    Keep my edits
                  </Button>
                </div>
              </>
            )}
          </Alert>
        )}
        {previewed ? (
          <div className="space-y-3">
            <ChangePreview eventCount={previewed.eventCount} impacts={previewed.impacts} />
            <div className="flex flex-wrap gap-2">
              <Button
                ref={applyRef}
                type="button"
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
                    : applyLabel(previewed.eventCount, counterparty.name, confirmed)}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={change.pending || change.uncertain}
                onClick={() => {
                  requestSubmit();
                  change.reset();
                }}
              >
                Keep editing
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Button ref={submitRef} type="submit" disabled={change.pending}>
              {change.previewing ? "Calculating…" : confirmed ? "Preview" : "Preview and confirm"}
            </Button>
            {change.applied && <output className="type-small text-slate">Saved.</output>}
          </div>
        )}
      </form>
    </section>
  );
}

function applyLabel(eventCount: number, name: string, confirmed: boolean) {
  if (eventCount === 1) return `Apply to the one ${name} transaction`;
  if (eventCount > 1) return `Apply to all ${eventCount} ${name} transactions`;
  return confirmed ? "Save" : "Confirm";
}

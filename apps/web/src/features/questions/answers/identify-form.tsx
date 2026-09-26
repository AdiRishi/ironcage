import type {
  CounterpartyChange,
  CounterpartyFields,
  CounterpartyId,
  ReferenceData,
  Version,
} from "@repo/contracts/finance";
import { takesDefaultRole } from "@repo/finance";
import { useForm, useStore } from "@tanstack/react-form";
import { Schema } from "effect";
import { useId } from "react";

import { CategorySelect, categoryForRole, roleTree } from "@/components/category-select";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { kindRole, rolesFor } from "@/features/counterparties/choices";
import { CounterpartyCombobox } from "@/features/counterparties/counterparty-combobox";
import { KindSelect, RoleSelect } from "@/features/counterparties/fields";

import { IdentifyAnswer } from "./answer-schema";
import type { Answer, FocusRef } from "./use-answer";

// Who an answer names: a counterparty you have, or a new one with its defaults.
export type Identified =
  | Extract<NonNullable<(typeof IdentifyAnswer.Type)["identity"]>, { kind: "existing" }>
  | { kind: "new"; fields: typeof CounterpartyFields.Type };

// Records who is behind a descriptor: it moves to a counterparty you have, or a new
// counterparty takes it.
export const identifyDescriptor =
  (aliasKey: string, expectedVersion: typeof Version.Type | null) =>
  (identified: Identified): CounterpartyChange =>
    identified.kind === "existing"
      ? {
          kind: "moveAlias",
          aliasKey,
          expectedVersion,
          counterpartyId: identified.counterparty.id,
          event: null,
        }
      : { kind: "create", fields: identified.fields, aliases: [{ aliasKey, expectedVersion }] };

// Names who is behind a question. Choosing a counterparty you already have joins these
// transactions to it, and only a name you do not have yet creates one, so an answer never
// duplicates a counterparty. A new person needs a role, or the question would stay open.
export function IdentifyForm({
  answer,
  submitRef,
  references,
  excluding,
  initial,
  toChange,
}: {
  answer: Answer;
  submitRef: FocusRef;
  references: typeof ReferenceData.Type;
  // A counterparty the answer cannot name, such as the one it is about.
  excluding: typeof CounterpartyId.Type | null;
  initial: typeof IdentifyAnswer.Type;
  toChange: (identified: Identified) => CounterpartyChange;
}) {
  const id = useId();
  const form = useForm({
    defaultValues: initial,
    validators: { onSubmit: Schema.toStandardSchemaV1(Schema.toType(IdentifyAnswer)) },
    listeners: { onChange: () => answer.change.reset() },
    onSubmit: ({ value: { identity, kind, defaultRole, defaultCategoryId } }) => {
      if (identity?.kind === "existing") answer.submit(toChange(identity));
      if (identity?.kind === "new")
        answer.submit(
          toChange({
            kind: "new",
            fields: {
              name: identity.name,
              kind,
              brand: null,
              defaultRole: kindRole(kind, defaultRole),
              defaultCategoryId: kind === "ownAccount" ? null : defaultCategoryId,
            },
          }),
        );
    },
  });
  const identity = useStore(form.store, (state) => state.values.identity);
  const kind = useStore(form.store, (state) => state.values.kind);
  const role = useStore(form.store, (state) =>
    kindRole(state.values.kind, state.values.defaultRole),
  );
  const keepCategory = (next: typeof role) =>
    form.setFieldValue("defaultCategoryId", (categoryId) =>
      categoryForRole(references.categories, next, categoryId),
    );
  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        form.handleSubmit().catch(reportError);
      }}
    >
      <fieldset disabled={answer.busy}>
        <FieldGroup className="gap-5">
          <form.Field name="identity">
            {(field) => (
              <Field data-invalid={field.state.meta.errors.length > 0}>
                <FieldLabel htmlFor={`${id}-identity`}>Who it is</FieldLabel>
                <CounterpartyCombobox
                  id={`${id}-identity`}
                  counterparties={references.counterparties}
                  excluding={excluding}
                  value={
                    field.state.value?.kind === "existing"
                      ? field.state.value.counterparty.id
                      : null
                  }
                  onValueChange={(counterparty) =>
                    field.handleChange(counterparty && { kind: "existing", counterparty })
                  }
                  create={{
                    name: field.state.value?.kind === "new" ? field.state.value.name : null,
                    onCreate: (name) => field.handleChange({ kind: "new", name }),
                  }}
                  disabled={answer.busy}
                />
                <FieldError errors={field.state.meta.errors} />
              </Field>
            )}
          </form.Field>
          {identity?.kind === "existing" && (
            <p className="type-small text-slate">
              These transactions will follow {identity.counterparty.name} and its defaults.
            </p>
          )}
          {identity?.kind === "new" && (
            <>
              <form.Field
                name="kind"
                listeners={{
                  onChange: ({ value }) => {
                    keepCategory(kindRole(value, form.getFieldValue("defaultRole")));
                  },
                }}
              >
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor={`${id}-kind`}>What they are</FieldLabel>
                    <KindSelect
                      id={`${id}-kind`}
                      className="w-full"
                      value={field.state.value}
                      onValueChange={field.handleChange}
                    />
                  </Field>
                )}
              </form.Field>
              {takesDefaultRole(kind) && (
                <form.Field
                  name="defaultRole"
                  listeners={{
                    onChange: ({ value }) => {
                      keepCategory(value);
                    },
                  }}
                >
                  {(field) => (
                    <Field data-invalid={field.state.meta.errors.length > 0}>
                      <FieldLabel htmlFor={`${id}-role`}>Money to or from them is</FieldLabel>
                      <RoleSelect
                        id={`${id}-role`}
                        className="w-full"
                        roles={rolesFor(kind)}
                        // A person's payments need a role, and an institution's can be
                        // decided payment by payment.
                        none={kind === "person" ? null : "Decide from each payment"}
                        value={role}
                        onValueChange={field.handleChange}
                        invalid={field.state.meta.errors.length > 0}
                      />
                      <FieldError errors={field.state.meta.errors} />
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
                        tree={roleTree(role)}
                        value={field.state.value}
                        onChange={field.handleChange}
                      />
                    </Field>
                  )}
                </form.Field>
              )}
            </>
          )}
        </FieldGroup>
      </fieldset>
      <Button ref={submitRef} type="submit" size="sm" disabled={answer.busy}>
        Preview
      </Button>
    </form>
  );
}

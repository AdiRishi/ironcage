import type {
  CategoryId,
  CounterpartyChange,
  CounterpartyFields,
  PersonRole,
} from "@repo/contracts/finance";
import { useForm, useStore } from "@tanstack/react-form";
import { Schema } from "effect";
import { useId, useState } from "react";

import { CategorySelect, categoryForRole, roleTree } from "@/components/category-select";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { personRoles } from "@/features/counterparties/choices";
import { RoleSelect } from "@/features/counterparties/fields";

import { markedLike, roleText } from "../describe";
import { Accept, AnswerActions, type AnswerProps, AnswerPreview } from "./answer-actions";
import { PersonAnswerFields } from "./answer-schema";
import { useAnswer } from "./use-answer";

const Scope = Schema.Literals(["reference", "every"]);

// What payments with a person are. With a reference, the answer can cover only the
// payments that carry it, so rent and a bill split to one person stay apart. Your own
// money at another bank makes the person an own account instead.
export function PersonAnswer({ question, references, onSkip, onAnswered }: AnswerProps<"person">) {
  const id = useId();
  const [answer, { acceptRef, submitRef, applyRef }] = useAnswer(onAnswered);
  const { counterparty, reference, proposal } = question;
  const [scope, setScope] = useState<typeof Scope.Type>(reference ? "reference" : "every");
  const update = (
    fields: Pick<typeof CounterpartyFields.Type, "kind" | "defaultRole" | "defaultCategoryId">,
  ): CounterpartyChange => ({
    kind: "update",
    counterpartyId: counterparty.id,
    expectedVersion: counterparty.version,
    fields: { name: counterparty.name, brand: counterparty.brand, ...fields },
  });
  const settle = (role: PersonRole, categoryId: typeof CategoryId.Type | null) =>
    reference && scope === "reference"
      ? ({
          kind: "saveReference",
          counterpartyId: counterparty.id,
          referenceKey: reference.key,
          expectedVersion: null,
          defaultRole: role,
          defaultCategoryId: categoryId,
        } satisfies CounterpartyChange)
      : update({ kind: "person", defaultRole: role, defaultCategoryId: categoryId });
  const form = useForm({
    defaultValues: { role: proposal?.role ?? null, categoryId: proposal?.categoryId ?? null },
    validators: { onSubmit: Schema.toStandardSchemaV1(Schema.toType(PersonAnswerFields)) },
    listeners: { onChange: () => answer.change.reset() },
    onSubmit: ({ value }) => {
      if (value.role) answer.submit(settle(value.role, value.categoryId));
    },
  });
  const role = useStore(form.store, (state) => state.values.role);
  return (
    <div className="space-y-4">
      {reference && (
        <div className="space-y-2">
          <p id={`${id}-scope`} className="type-small text-slate">
            Which payments the answer covers
          </p>
          <RadioGroup
            aria-labelledby={`${id}-scope`}
            value={scope}
            onValueChange={(next) => {
              if (!Schema.is(Scope)(next)) return;
              setScope(next);
              answer.change.reset();
            }}
            disabled={answer.busy}
          >
            <label className="flex items-start gap-3">
              <RadioGroupItem value="reference" className="mt-0.5" />
              <span>Only payments {markedLike(reference)}</span>
            </label>
            <label className="flex items-start gap-3">
              <RadioGroupItem value="every" className="mt-0.5" />
              <span>Every payment with {counterparty.name}</span>
            </label>
          </RadioGroup>
        </div>
      )}
      <AnswerActions
        accept={
          proposal && (
            <Accept
              answer={answer}
              acceptRef={acceptRef}
              change={settle(proposal.role, proposal.categoryId)}
            >
              Yes, {roleText(proposal.role, proposal.categoryId, references.categories)}
            </Accept>
          )
        }
        other={proposal ? "Something else" : "Say what they are"}
        onSkip={onSkip}
        disabled={answer.busy}
      >
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            form.handleSubmit().catch(reportError);
          }}
        >
          <fieldset disabled={answer.busy}>
            <FieldGroup className="gap-5">
              <form.Field
                name="role"
                listeners={{
                  onChange: ({ value }) => {
                    form.setFieldValue("categoryId", (categoryId) =>
                      categoryForRole(references.categories, value, categoryId),
                    );
                  },
                }}
              >
                {(field) => (
                  <Field data-invalid={field.state.meta.errors.length > 0}>
                    <FieldLabel htmlFor={`${id}-role`}>These payments are</FieldLabel>
                    <RoleSelect
                      id={`${id}-role`}
                      className="w-full"
                      roles={personRoles}
                      none={null}
                      value={field.state.value}
                      onValueChange={field.handleChange}
                      invalid={field.state.meta.errors.length > 0}
                    />
                    <FieldError errors={field.state.meta.errors} />
                  </Field>
                )}
              </form.Field>
              <form.Field name="categoryId">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor={`${id}-category`}>Category</FieldLabel>
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
            </FieldGroup>
          </fieldset>
          <div className="flex flex-wrap gap-2">
            <Button ref={submitRef} type="submit" size="sm" disabled={answer.busy}>
              Preview
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={answer.busy}
              onClick={() =>
                answer.submit(
                  update({ kind: "ownAccount", defaultRole: null, defaultCategoryId: null }),
                )
              }
            >
              It's me, at another bank
            </Button>
          </div>
        </form>
      </AnswerActions>
      <AnswerPreview answer={answer} applyRef={applyRef} />
    </div>
  );
}

import {
  AllocationId,
  ApplyCorrection,
  CalendarDate,
  CommandId,
  EventChange,
  type FinancialEvent,
  type ReferenceData,
} from "@repo/contracts/finance";
import { allocationRole, financialRoleLabels, formatDecimal, parseMoney } from "@repo/finance";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Effect, Schema } from "effect";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCommand } from "@/lib/use-command";

import { ReferenceChoice } from "./choice";
import { applyCorrection, previewCorrection } from "./functions";
import { ImpactTable } from "./impact";

export function EventEditor({
  event,
  references,
  onClose,
}: {
  event: FinancialEvent;
  references: typeof ReferenceData.Type;
  onClose: () => void;
}) {
  const id = useId();
  const [inputError, setInputError] = useState<string | null>(null);
  const client = useQueryClient();
  const preview = useMutation({
    mutationFn: async (change: EventChange) =>
      previewCorrection({
        data: { change: await Effect.runPromise(Schema.encodeEffect(EventChange)(change)) },
      }),
  });
  const { mutation, submit, uncertain } = useCommand({
    mutationFn: async (data: typeof ApplyCorrection.Type) =>
      applyCorrection({
        data: await Effect.runPromise(Schema.encodeEffect(ApplyCorrection)(data)),
      }),
    onSuccess: async () => {
      await client.invalidateQueries();
      onClose();
    },
  });
  const form = useForm({
    defaultValues: {
      kind: event.kind,
      purchaseOn: event.purchaseOn ?? "",
      allocations: event.allocations.map((allocation) => ({
        ...allocation,
        decimal: formatDecimal(allocation.amount),
      })),
    },
    onSubmit: async ({ value }) => {
      preview.reset();
      setInputError(null);
      const decoded = await Effect.runPromise(
        Effect.gen(function* () {
          const allocations = yield* Effect.forEach(
            value.allocations,
            Effect.fn(function* ({ decimal, ...allocation }) {
              return {
                ...allocation,
                role: allocationRole(value.kind),
                amount: yield* parseMoney(decimal, event.magnitude.currency),
              };
            }),
          );
          return yield* Schema.decodeUnknownEffect(Schema.toType(EventChange))({
            eventId: event.id,
            kind: value.kind,
            purchaseOn: value.purchaseOn
              ? yield* Schema.decodeEffect(CalendarDate)(value.purchaseOn)
              : null,
            allocations,
          });
        }).pipe(Effect.result),
      );
      if (decoded._tag === "Failure") {
        setInputError(decoded.failure.message);
        return;
      }
      preview.mutate(decoded.success);
    },
  });
  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit().catch(reportError);
      }}
      onChange={() => preview.reset()}
    >
      <fieldset disabled={mutation.isPending || uncertain} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <form.Field name="kind">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor={`${id}-role`}>Financial role</Label>
                <Select
                  items={financialRoleLabels}
                  value={field.state.value}
                  onValueChange={(value) => {
                    if (value) {
                      field.handleChange(value);
                      preview.reset();
                    }
                  }}
                >
                  <SelectTrigger id={`${id}-role`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(financialRoleLabels).map(([role, label]) => (
                      <SelectItem key={role} value={role}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </form.Field>
          <form.Field name="purchaseOn">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor={`${id}-date`}>Purchase date</Label>
                <Input
                  id={`${id}-date`}
                  type="date"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              </div>
            )}
          </form.Field>
        </div>
        <form.Field name="allocations" mode="array">
          {(array) => (
            <div className="space-y-4">
              {array.state.value.map((allocation, index) => (
                <div key={allocation.id} className="space-y-4 rounded-md border p-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium">Allocation {index + 1}</h3>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={array.state.value.length === 1}
                      onClick={() => {
                        array.removeValue(index);
                        preview.reset();
                      }}
                    >
                      Remove allocation {index + 1}
                    </Button>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <form.Field name={`allocations[${index}].decimal`}>
                      {(field) => (
                        <div className="space-y-2">
                          <Label htmlFor={`${id}-amount-${index}`}>
                            Amount {index + 1} ({event.magnitude.currency})
                          </Label>
                          <Input
                            id={`${id}-amount-${index}`}
                            inputMode="decimal"
                            required
                            pattern="[0-9]+(\.[0-9]+)?"
                            value={field.state.value}
                            onChange={(e) => field.handleChange(e.target.value)}
                          />
                        </div>
                      )}
                    </form.Field>
                    <form.Field name={`allocations[${index}].categoryId`}>
                      {(field) => (
                        <ReferenceChoice
                          label={`Category ${index + 1}`}
                          value={field.state.value}
                          options={references.categories.filter(
                            (category) => !category.archived || category.id === field.state.value,
                          )}
                          onChange={(value) => {
                            field.handleChange(value);
                            preview.reset();
                          }}
                        />
                      )}
                    </form.Field>
                  </div>
                  <form.Field name={`allocations[${index}].nonPersonal`}>
                    {(field) => (
                      <Label>
                        <Checkbox
                          checked={field.state.value}
                          onCheckedChange={(value) => {
                            field.handleChange(value === true);
                            preview.reset();
                          }}
                        />
                        Non-personal portion
                      </Label>
                    )}
                  </form.Field>
                  <form.Field name={`allocations[${index}].tagIds`}>
                    {(field) => (
                      <div className="flex flex-wrap gap-4">
                        <span className="text-sm">Tags</span>
                        {references.tags.map((tag) => (
                          <Label key={tag.id}>
                            <Checkbox
                              checked={field.state.value.includes(tag.id)}
                              onCheckedChange={(checked) => {
                                field.handleChange(
                                  checked
                                    ? [...field.state.value, tag.id]
                                    : field.state.value.filter((value) => value !== tag.id),
                                );
                                preview.reset();
                              }}
                            />
                            {tag.name}
                          </Label>
                        ))}
                      </div>
                    )}
                  </form.Field>
                  <form.Field name={`allocations[${index}].personalEventIds`}>
                    {(field) => (
                      <div className="flex flex-wrap gap-4">
                        <span className="text-sm">Personal events</span>
                        {references.personalEvents.map((personal) => (
                          <Label key={personal.id}>
                            <Checkbox
                              checked={field.state.value.includes(personal.id)}
                              onCheckedChange={(checked) => {
                                field.handleChange(
                                  checked
                                    ? [...field.state.value, personal.id]
                                    : field.state.value.filter((value) => value !== personal.id),
                                );
                                preview.reset();
                              }}
                            />
                            {personal.name}
                          </Label>
                        ))}
                      </div>
                    )}
                  </form.Field>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  array.pushValue({
                    id: AllocationId.make(crypto.randomUUID()),
                    role: "purchase",
                    amount: { currency: event.magnitude.currency, minor: 0n },
                    decimal: "0.00",
                    categoryId: null,
                    categorySource: null,
                    nonPersonal: false,
                    tagIds: [],
                    personalEventIds: [],
                  });
                  preview.reset();
                }}
              >
                Add allocation
              </Button>
            </div>
          )}
        </form.Field>
        <Button type="submit" disabled={preview.isPending}>
          {preview.isPending ? "Calculating…" : "Preview correction"}
        </Button>
      </fieldset>
      {inputError && <p role="alert">{inputError}</p>}
      {preview.error && <p role="alert">{preview.error.message}</p>}
      {preview.data && <ImpactTable impact={preview.data.impact} />}
      {mutation.error && <p role="alert">{mutation.error.message}</p>}
      <div className="flex gap-3">
        <Button
          type="button"
          disabled={mutation.isPending || (!preview.data && !uncertain)}
          onClick={() => {
            if (preview.data)
              submit({
                commandId: CommandId.make(crypto.randomUUID()),
                change: preview.data.change,
                expectedVersions: preview.data.expectedVersions,
              });
          }}
        >
          {uncertain ? "Retry correction" : "Save correction"}
        </Button>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

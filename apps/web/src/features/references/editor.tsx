import {
  CommandId,
  ReferenceWrite,
  SaveReference,
  type ReferenceData,
} from "@repo/contracts/finance";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { Effect, Schema } from "effect";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ReferenceChoice } from "@/features/events/choice";
import { AppRequestError } from "@/lib/app-error";
import { useCommand } from "@/lib/use-command";

import { saveReference } from "./functions";

export function ReferenceEditor({
  record,
  references,
  onClose,
}: {
  record: typeof ReferenceWrite.Type;
  references: typeof ReferenceData.Type;
  onClose: () => void;
}) {
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  const client = useQueryClient();
  const [target, setTarget] = useState(record.target);
  const current = [
    ...references.categories,
    ...references.merchants,
    ...references.tags,
    ...references.personalEvents,
  ].find((item) => target.kind === "update" && item.id === target.id);
  const { mutation, submit, uncertain } = useCommand({
    mutationFn: (data: typeof SaveReference.Type) => saveReference({ data }),
    onSuccess: async () => {
      await client.invalidateQueries();
      onClose();
    },
  });
  const form = useForm({
    defaultValues: {
      name: record.name,
      parentId: record.kind === "category" ? record.parentId : null,
      archived: record.kind === "category" && record.archived,
      aliases: record.kind === "merchant" ? record.aliases.join("\n") : "",
      startOn: record.kind === "personalEvent" ? record.startOn : "",
      endOn: record.kind === "personalEvent" ? record.endOn : "",
      excludeFromOrdinary: record.kind === "personalEvent" && record.excludeFromOrdinary,
    },
    onSubmit: async ({ value }) => {
      setError(null);
      const common = { ...record, target, name: value.name };
      const draft =
        record.kind === "category"
          ? { ...common, parentId: value.parentId, archived: value.archived }
          : record.kind === "merchant"
            ? {
                ...common,
                aliases: value.aliases
                  .split("\n")
                  .map((alias) => alias.trim())
                  .filter(Boolean),
              }
            : record.kind === "personalEvent"
              ? {
                  ...common,
                  startOn: value.startOn,
                  endOn: value.endOn,
                  excludeFromOrdinary: value.excludeFromOrdinary,
                }
              : common;
      const result = await Effect.runPromise(
        Schema.decodeEffect(SaveReference)({
          commandId: CommandId.make(crypto.randomUUID()),
          record: draft,
        }).pipe(Effect.result),
      );
      if (result._tag === "Failure") {
        setError(result.failure.message);
        return;
      }
      submit(result.success);
    },
  });
  return (
    <form
      className="space-y-4 rounded-lg border p-5"
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit().catch(reportError);
      }}
    >
      <h2 className="font-semibold">
        {record.target.kind === "create" ? "Create" : "Edit"}{" "}
        {record.kind === "personalEvent" ? "personal event" : record.kind}
      </h2>
      <fieldset disabled={mutation.isPending || uncertain} className="space-y-4">
        <form.Field name="name">
          {(field) => (
            <div className="space-y-2">
              <Label htmlFor={`${id}-name`}>Name</Label>
              <Input
                id={`${id}-name`}
                required
                maxLength={100}
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
              />
            </div>
          )}
        </form.Field>
        {record.kind === "category" && (
          <>
            <form.Field name="parentId">
              {(field) => (
                <ReferenceChoice
                  label="Parent category"
                  value={field.state.value}
                  options={references.categories}
                  onChange={field.handleChange}
                />
              )}
            </form.Field>
            <form.Field name="archived">
              {(field) => (
                <Label>
                  <Checkbox
                    checked={field.state.value}
                    onCheckedChange={(checked) => field.handleChange(checked === true)}
                  />
                  Archived
                </Label>
              )}
            </form.Field>
          </>
        )}
        {record.kind === "merchant" && (
          <form.Field name="aliases">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor={`${id}-aliases`}>Description aliases, one phrase per line</Label>
                <Textarea
                  id={`${id}-aliases`}
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
                <p className="text-sm text-muted-foreground">
                  Aliases match description text without case sensitivity.
                </p>
              </div>
            )}
          </form.Field>
        )}
        {record.kind === "personalEvent" && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <form.Field name="startOn">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor={`${id}-start`}>Start date</Label>
                    <Input
                      id={`${id}-start`}
                      type="date"
                      required
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                  </div>
                )}
              </form.Field>
              <form.Field name="endOn">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor={`${id}-end`}>End date</Label>
                    <Input
                      id={`${id}-end`}
                      type="date"
                      required
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                  </div>
                )}
              </form.Field>
            </div>
            <form.Field name="excludeFromOrdinary">
              {(field) => (
                <Label>
                  <Checkbox
                    checked={field.state.value}
                    onCheckedChange={(checked) => field.handleChange(checked === true)}
                  />
                  Exclude from ordinary costs
                </Label>
              )}
            </form.Field>
          </>
        )}
      </fieldset>
      {(error || mutation.error) && <p role="alert">{error ?? mutation.error?.message}</p>}
      {mutation.error instanceof AppRequestError &&
        mutation.error.code === "stale" &&
        current &&
        target.kind === "update" && (
          <div className="space-y-2">
            <p>Current saved name: {current.name}. Your unsaved fields are kept above.</p>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setTarget({ ...target, expectedVersion: current.version });
                mutation.reset();
              }}
            >
              Use current version
            </Button>
          </div>
        )}
      <div className="flex gap-3">
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? "Saving…" : uncertain ? "Retry save" : "Save"}
        </Button>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

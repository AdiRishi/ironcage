import {
  AnalysisName,
  CommandId,
  type ContributorsInput,
  type SavedAnalysis,
} from "@repo/contracts/finance";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { Schema } from "effect";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCommand } from "@/lib/use-command";

import { definitionSummary } from "./definition";
import { renameAnalysis, saveAnalysis } from "./saved-functions";

const Fields = Schema.Struct({ name: AnalysisName });
type Action =
  | { kind: "save"; definition: typeof ContributorsInput.Type }
  | { kind: "rename"; analysis: SavedAnalysis };
export function AnalysisNameDialog({ action }: { action: Action }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const client = useQueryClient();
  const title = action.kind === "save" ? "Save as analysis" : "Rename analysis";
  const command = useCommand({
    mutationFn: (data: { commandId: typeof CommandId.Type; name: string; action: Action }) =>
      data.action.kind === "save"
        ? saveAnalysis({
            data: {
              commandId: data.commandId,
              name: data.name,
              definition: data.action.definition,
            },
          })
        : renameAnalysis({
            data: {
              commandId: data.commandId,
              name: data.name,
              id: data.action.analysis.id,
              expectedVersion: data.action.analysis.version,
            },
          }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["savedAnalyses"] });
      setOpen(false);
    },
  });
  const form = useForm({
    defaultValues: { name: action.kind === "rename" ? action.analysis.name : "" },
    validators: { onSubmit: Schema.toStandardSchemaV1(Fields) },
    onSubmit: ({ value }) =>
      command.submit({
        commandId: CommandId.make(crypto.randomUUID()),
        name: value.name.trim(),
        action,
      }),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (value && !command.mutation.isPending && !command.uncertain) {
          form.reset();
          command.mutation.reset();
        }
        setOpen(value);
      }}
    >
      <DialogTrigger render={<Button variant="outline" />}>{title}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {action.kind === "save"
              ? definitionSummary(action.definition)
              : "The saved question and its dates stay the same."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            form.handleSubmit().catch(reportError);
          }}
        >
          <form.Field name="name">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor={id}>Analysis name</Label>
                <Input
                  id={id}
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                  disabled={command.mutation.isPending || command.uncertain}
                  required
                  maxLength={100}
                  aria-invalid={field.state.meta.errors.length > 0}
                  aria-describedby={`${id}-error`}
                />
                <FieldError id={`${id}-error`} errors={field.state.meta.errors} />
              </div>
            )}
          </form.Field>
          {command.mutation.error && (
            <p role="alert" className="text-sm text-destructive">
              {command.mutation.error.message}
            </p>
          )}
          <Button type="submit" disabled={command.mutation.isPending}>
            {command.mutation.isPending ? "Saving…" : command.uncertain ? "Retry save" : "Save"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

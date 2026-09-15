import { CommandId, CreateAccount } from "@repo/contracts/finance";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { Schema, Struct } from "effect";
import { useId, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCommand } from "@/lib/use-command";

import { createAccount } from "./functions";
import { accountKindLabels } from "./labels";

const Fields = Schema.Struct(Struct.omit(CreateAccount.fields, ["commandId"]));
const defaults: typeof Fields.Type = { label: "", kind: "deposit", currency: "AUD" };
export function CreateAccountDialog() {
  const id = useId();
  const [open, setOpen] = useState(false);
  const client = useQueryClient();
  const { mutation, submit, uncertain } = useCommand({
    mutationFn: (data: typeof CreateAccount.Type) => createAccount({ data }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["accounts"] });
      setOpen(false);
    },
  });
  const form = useForm({
    defaultValues: defaults,
    validators: { onSubmit: Schema.toStandardSchemaV1(Fields) },
    onSubmit: ({ value }) => submit({ ...value, commandId: CommandId.make(crypto.randomUUID()) }),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (value && !uncertain) {
          form.reset();
          mutation.reset();
        }
        setOpen(value);
      }}
    >
      <DialogTrigger render={<Button variant="outline" />}>Add account</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add an account</DialogTitle>
          <DialogDescription>Choose this account when importing its CSV exports.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            form.handleSubmit().catch(reportError);
          }}
        >
          <fieldset disabled={mutation.isPending || uncertain} className="space-y-5">
            <form.Field name="label">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor={`${id}-label`}>Account name</Label>
                  <Input
                    id={`${id}-label`}
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                    onBlur={field.handleBlur}
                    placeholder="Everyday account"
                    required
                    maxLength={100}
                    aria-invalid={field.state.meta.errors.length > 0}
                    aria-describedby={`${id}-label-error`}
                  />
                  <FieldError id={`${id}-label-error`} errors={field.state.meta.errors} />
                </div>
              )}
            </form.Field>
            <form.Field name="kind">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor={`${id}-kind`}>Account type</Label>
                  <Select
                    items={accountKindLabels}
                    value={field.state.value}
                    onValueChange={(value) => {
                      if (value) field.handleChange(value);
                    }}
                  >
                    <SelectTrigger id={`${id}-kind`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(accountKindLabels).map(([kind, label]) => (
                        <SelectItem key={kind} value={kind}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </form.Field>
            <form.Field name="currency">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor={`${id}-currency`}>Currency</Label>
                  <Input
                    id={`${id}-currency`}
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value.toUpperCase())}
                    required
                    pattern="[A-Z]{3}"
                    maxLength={3}
                  />
                </div>
              )}
            </form.Field>
          </fieldset>
          {mutation.error && (
            <Alert variant="destructive">
              <AlertDescription>{mutation.error.message}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending
              ? "Adding account…"
              : uncertain
                ? "Retry add account"
                : "Add account"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

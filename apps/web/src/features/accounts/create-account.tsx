import { CommandId, CreateAccount } from "@repo/contracts/finance";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Schema, Struct } from "effect";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { createAccount } from "./functions";

const Fields = Schema.Struct(Struct.omit(CreateAccount.fields, ["commandId"]));
const defaults: typeof Fields.Type = { label: "", kind: "deposit", currency: "AUD" };
export function CreateAccountDialog() {
  const [open, setOpen] = useState(false);
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (data: typeof CreateAccount.Type) => createAccount({ data }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["accounts"] });
      setOpen(false);
    },
  });
  const form = useForm({
    defaultValues: defaults,
    validators: { onSubmit: Schema.toStandardSchemaV1(Fields) },
    onSubmit: async ({ value }) => {
      await mutation
        .mutateAsync({ ...value, commandId: CommandId.make(crypto.randomUUID()) })
        .catch(() => undefined);
    },
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
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
          <form.Field name="label">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor={field.name}>Account name</Label>
                <Input
                  id={field.name}
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                  placeholder="Everyday account"
                  required
                  maxLength={100}
                />
              </div>
            )}
          </form.Field>
          <form.Field name="kind">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor={field.name}>Account type</Label>
                <Select
                  value={field.state.value}
                  onValueChange={(value) => {
                    if (value) field.handleChange(value);
                  }}
                >
                  <SelectTrigger id={field.name}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="deposit">Deposit</SelectItem>
                    <SelectItem value="card">Credit card</SelectItem>
                    <SelectItem value="loan">Loan</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </form.Field>
          <form.Field name="currency">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor={field.name}>Currency</Label>
                <Input
                  id={field.name}
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value.toUpperCase())}
                  required
                  pattern="[A-Z]{3}"
                  maxLength={3}
                />
              </div>
            )}
          </form.Field>
          {mutation.isError && (
            <div role="alert" className="space-y-2 text-sm text-destructive">
              <p>{mutation.error.message}</p>
              <Button
                type="button"
                variant="outline"
                onClick={() => mutation.mutate(mutation.variables)}
              >
                Retry
              </Button>
            </div>
          )}
          <Button type="submit" disabled={mutation.isPending || mutation.isError}>
            {" "}
            {mutation.isPending ? "Adding account…" : "Add account"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

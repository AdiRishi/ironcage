import { CommandId, type Account, UpdateAccount } from "@repo/contracts/finance";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { Schema, Struct } from "effect";
import { useId, useState } from "react";

import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
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

import { updateAccount } from "./functions";
import { accountKindLabels } from "./labels";

const Fields = Schema.Struct(Struct.pick(UpdateAccount.fields, ["label", "kind"]));
export function EditAccountDialog({ account }: { account: Account }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const client = useQueryClient();
  const { mutation, submit, uncertain } = useCommand({
    mutationFn: (data: typeof UpdateAccount.Type) => updateAccount({ data }),
    onSuccess: async () => {
      await client.invalidateQueries({
        predicate: (query) =>
          ["accounts", "postings", "posting"].includes(String(query.queryKey[0])),
      });
      setOpen(false);
    },
  });
  const form = useForm({
    defaultValues: { label: account.label, kind: account.kind },
    validators: { onSubmit: Schema.toStandardSchemaV1(Fields) },
    onSubmit: ({ value }) =>
      submit({
        commandId: CommandId.make(crypto.randomUUID()),
        ...value,
        accountId: account.id,
        expectedVersion: account.version,
      }),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (value && !mutation.isPending && !uncertain) {
          form.reset({ label: account.label, kind: account.kind });
          mutation.reset();
        }
        setOpen(value);
      }}
    >
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        Edit<span className="sr-only"> {account.label}</span>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit account</DialogTitle>
          <DialogDescription>
            Bank identifiers stay attached to the original source evidence.
          </DialogDescription>
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
                    disabled={account.accountNumber !== null}
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
            {account.accountNumber && (
              <p className="text-sm text-muted-foreground">
                Bank {account.bankId ?? "not supplied"} · Account {account.accountNumber} ·{" "}
                {account.currency}
              </p>
            )}
          </fieldset>
          {mutation.error && (
            <Alert variant="destructive">
              <AlertDescription>{mutation.error.message}</AlertDescription>
              {!uncertain && (
                <AlertAction>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      mutation.reset();
                      client.invalidateQueries({ queryKey: ["accounts"] }).catch(reportError);
                    }}
                  >
                    Refresh
                  </Button>
                </AlertAction>
              )}
            </Alert>
          )}
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "Saving…" : uncertain ? "Retry save" : "Save account"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

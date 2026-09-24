import { CommandId, type Account, UpdateAccount } from "@repo/contracts/finance";
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
import { AppRequestError } from "@/lib/app-error";
import { useCommand } from "@/lib/use-command";

import { updateAccount } from "./functions";
import { accountKindLabels } from "./labels";

const Fields = Schema.Struct(Struct.pick(UpdateAccount.fields, ["label", "kind"]));
export function EditAccountDialog({ account }: { account: Account }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [baseline, setBaseline] = useState(account);
  const client = useQueryClient();
  const { mutation, submit, uncertain } = useCommand({
    mutationFn: (data: typeof UpdateAccount.Type) => updateAccount({ data }),
    onError: async (error) => {
      if (error instanceof AppRequestError && error.code === "stale")
        await client.invalidateQueries({ queryKey: ["accounts"] });
    },
    onSuccess: async () => {
      await client.invalidateQueries({
        predicate: (query) =>
          ["accounts", "postings", "posting"].includes(String(query.queryKey[0])),
      });
      setOpen(false);
    },
  });
  const stale = mutation.error instanceof AppRequestError && mutation.error.code === "stale";
  const form = useForm({
    defaultValues: { label: baseline.label, kind: baseline.kind },
    validators: { onSubmit: Schema.toStandardSchemaV1(Fields) },
    onSubmit: ({ value }) =>
      submit({
        commandId: CommandId.make(crypto.randomUUID()),
        ...value,
        accountId: account.id,
        expectedVersion: baseline.version,
      }),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (value && !mutation.isPending && !uncertain) {
          setBaseline(account);
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
              <p className="type-small text-slate">
                Bank {account.bankId ?? "not supplied"} · Account {account.accountNumber} ·{" "}
                {account.currency}
              </p>
            )}
          </fieldset>
          {mutation.error && (
            <Alert variant="destructive">
              <AlertDescription>{mutation.error.message}</AlertDescription>
              {stale && (
                <AlertDescription>
                  Current account: {account.label} · {accountKindLabels[account.kind]}. Your edits
                  are still in the form.
                </AlertDescription>
              )}
              {stale && (
                <div className="mt-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={account.version === baseline.version}
                    onClick={() => {
                      setBaseline(account);
                      mutation.reset();
                    }}
                  >
                    Keep my edits
                  </Button>
                </div>
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

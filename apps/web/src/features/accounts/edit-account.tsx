import { CommandId, type Account, UpdateAccount } from "@repo/contracts/finance";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
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
import { useCommand } from "@/lib/use-command";

import { updateAccount } from "./functions";

const Fields = Schema.Struct(Struct.pick(UpdateAccount.fields, ["label", "kind"]));
const kinds = { deposit: "Deposit", card: "Credit card", loan: "Loan" };
export function EditAccountDialog({ account }: { account: Account }) {
  const [open, setOpen] = useState(false);
  const client = useQueryClient();
  const { mutation, submit, uncertain } = useCommand({
    mutationFn: (data: typeof UpdateAccount.Type) => updateAccount({ data }),
    onSuccess: async () => {
      await client.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === "accounts" ||
          query.queryKey[0] === "postings" ||
          query.queryKey[0] === "posting",
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
        if (value && !uncertain) {
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
                  <Label htmlFor="account-label">Account name</Label>
                  <Input
                    id="account-label"
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                    required
                    maxLength={100}
                  />
                </div>
              )}
            </form.Field>
            <form.Field name="kind">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor="account-kind">Account type</Label>
                  <Select
                    items={kinds}
                    disabled={account.accountNumber !== null}
                    value={field.state.value}
                    onValueChange={(value) => {
                      if (value) field.handleChange(value);
                    }}
                  >
                    <SelectTrigger id="account-kind">
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
            {account.accountNumber && (
              <p className="text-sm text-muted-foreground">
                Bank {account.bankId ?? "not supplied"} · Account {account.accountNumber} ·{" "}
                {account.currency}
              </p>
            )}
          </fieldset>
          {mutation.error && (
            <div role="alert" className="space-y-2 text-sm text-destructive">
              <p>{mutation.error.message}</p>
              {!uncertain && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    mutation.reset();
                    client.invalidateQueries({ queryKey: ["accounts"] }).catch(reportError);
                  }}
                >
                  Refresh account
                </Button>
              )}
            </div>
          )}
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "Saving…" : uncertain ? "Retry save" : "Save account"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

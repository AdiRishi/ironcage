import {
  AccountPeriod,
  AccountPeriodId,
  CommandId,
  type Account,
  type SaveAccountPeriod,
  type DeleteAccountPeriod,
} from "@repo/contracts/finance";
import { useForm } from "@tanstack/react-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Schema } from "effect";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCommand } from "@/lib/use-command";

import { ReferenceChoice } from "../events/choice";
import { deleteAccountPeriod, listAccountPeriods, saveAccountPeriod } from "./period-functions";
export function AccountPeriodsSection({ accounts }: { accounts: readonly Account[] }) {
  const query = useQuery({ queryKey: ["accountPeriods"], queryFn: () => listAccountPeriods() });
  const client = useQueryClient();
  const [editing, setEditing] = useState<{
    kind: AccountPeriod["kind"];
    record: AccountPeriod | null;
  } | null>(null);
  const deletion = useCommand({
    mutationFn: (data: typeof DeleteAccountPeriod.Type) => deleteAccountPeriod({ data }),
    onSuccess: () => client.invalidateQueries(),
  });
  return (
    <section className="space-y-4">
      <h2 className="type-heading">Account history and offsets</h2>
      <p className="type-small text-slate">
        Periods include the start date and exclude the end date. Leave the end blank for an ongoing
        period. Labels apply to transactions posted in that period.
      </p>
      <div className="flex flex-wrap gap-3">
        <Button variant="outline" onClick={() => setEditing({ kind: "label", record: null })}>
          Add label period
        </Button>
        <Button variant="outline" onClick={() => setEditing({ kind: "offset", record: null })}>
          Add offset relationship
        </Button>
      </div>
      {query.data?.map((record) => (
        <div
          className="flex flex-wrap items-center justify-between gap-3 border-t pt-3"
          key={record.id}
        >
          <div>
            <p>
              {accounts.find((account) => account.id === record.accountId)?.label} ·{" "}
              {record.kind === "label"
                ? record.label
                : `Offsets ${accounts.find((account) => account.id === record.loanAccountId)?.label}`}
            </p>
            <p className="type-small text-slate">
              {record.startOn} to {record.endOn ?? "ongoing"}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setEditing({ kind: record.kind, record })}>
              Edit period
            </Button>
            <Button
              variant="ghost"
              disabled={deletion.mutation.isPending}
              onClick={() =>
                deletion.submit({
                  commandId: CommandId.make(crypto.randomUUID()),
                  id: record.id,
                  kind: record.kind,
                  expectedVersion: record.version,
                })
              }
            >
              {deletion.uncertain ? "Retry deletion" : "Delete period"}
            </Button>
          </div>
        </div>
      ))}
      {editing && (
        <PeriodEditor
          key={editing.record?.id ?? editing.kind}
          accounts={accounts}
          kind={editing.kind}
          record={editing.record}
          onClose={() => setEditing(null)}
        />
      )}
      {query.error && <p role="alert">{query.error.message}</p>}
      {deletion.mutation.error && <p role="alert">{deletion.mutation.error.message}</p>}
    </section>
  );
}
function PeriodEditor({
  accounts,
  kind,
  record,
  onClose,
}: {
  accounts: readonly Account[];
  kind: AccountPeriod["kind"];
  record: AccountPeriod | null;
  onClose: () => void;
}) {
  const id = useId();
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const command = useCommand({
    mutationFn: (data: typeof SaveAccountPeriod.Type) => saveAccountPeriod({ data }),
    onSuccess: async () => {
      await client.invalidateQueries();
      onClose();
    },
  });
  const form = useForm({
    defaultValues: {
      accountId: record?.accountId ?? null,
      loanAccountId: record?.kind === "offset" ? record.loanAccountId : null,
      label: record?.kind === "label" ? record.label : "",
      startOn: record?.startOn ?? "",
      endOn: record?.endOn ?? "",
    },
    onSubmit: ({ value }) => {
      const candidate = {
        ...value,
        kind,
        id: record?.id ?? AccountPeriodId.make(crypto.randomUUID()),
        version: record?.version ?? 1,
        endOn: value.endOn || null,
      };
      const parsed = Schema.decodeUnknownResult(AccountPeriod)(candidate);
      if (parsed._tag === "Failure") {
        setError("Choose the accounts and enter valid dates and a label where required.");
        return;
      }
      setError(null);
      command.submit({
        commandId: CommandId.make(crypto.randomUUID()),
        record: parsed.success,
        expectedVersion: record?.version ?? null,
      });
    },
  });
  return (
    <form
      className="space-y-4 border-t pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit().catch(reportError);
      }}
    >
      <fieldset className="space-y-4" disabled={command.mutation.isPending || command.uncertain}>
        <form.Field name="accountId">
          {(field) => (
            <ReferenceChoice
              label={kind === "label" ? "Account" : "Deposit account"}
              value={field.state.value}
              onChange={field.handleChange}
              options={accounts
                .filter((account) => kind === "label" || account.kind === "deposit")
                .map((account) => ({ id: account.id, name: account.label }))}
            />
          )}
        </form.Field>
        {kind === "offset" ? (
          <form.Field name="loanAccountId">
            {(field) => (
              <ReferenceChoice
                label="Loan account"
                value={field.state.value}
                onChange={field.handleChange}
                options={accounts
                  .filter((account) => account.kind === "loan")
                  .map((account) => ({ id: account.id, name: account.label }))}
              />
            )}
          </form.Field>
        ) : (
          <form.Field name="label">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor={`${id}-label`}>Effective account label</Label>
                <Input
                  id={`${id}-label`}
                  required
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              </div>
            )}
          </form.Field>
        )}
        {(["startOn", "endOn"] as const).map((name) => (
          <form.Field key={name} name={name}>
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor={`${id}-${name}`}>
                  {name === "startOn" ? "Starts on" : "Ends before"}
                </Label>
                <Input
                  id={`${id}-${name}`}
                  type="date"
                  required={name === "startOn"}
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              </div>
            )}
          </form.Field>
        ))}
      </fieldset>
      {error && <p role="alert">{error}</p>}
      {command.mutation.error && <p role="alert">{command.mutation.error.message}</p>}
      <div className="flex gap-3">
        <Button type="submit" disabled={command.mutation.isPending}>
          {command.uncertain ? "Retry period" : "Save period"}
        </Button>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

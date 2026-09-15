import { AccountId, type ReviewItem } from "@repo/contracts/finance";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CreateAccountDialog } from "@/features/accounts/create-account";
import { accountsQueryOptions } from "@/features/accounts/queries";

import { RowChoice } from "./row-choice";
import { useResolution } from "./use-resolution";

export function ReviewCard({ review }: { review: ReviewItem }) {
  const { mutation, submit, uncertain, refresh } = useResolution(review);
  const blocked = mutation.isPending || uncertain;
  return (
    <section className="space-y-5 rounded-lg border p-5 sm:p-6">
      <header>
        <p className="text-sm break-all text-muted-foreground">{review.fileName}</p>
        <h2 className="mt-2 text-lg font-semibold">{review.question.message}</h2>
      </header>
      {review.kind === "account" ? (
        <AccountChoice
          disabled={blocked}
          onChoose={(accountId) => submit({ kind: "account", accountId })}
        />
      ) : (
        review.observations.map((row) => (
          <RowChoice
            key={row.id}
            row={row}
            review={review}
            disabled={blocked}
            onChoose={(decision) =>
              submit({ kind: "observations", decisions: [{ observationId: row.id, decision }] })
            }
          />
        ))
      )}
      {mutation.isPending && <output className="text-sm">Saving your decision…</output>}
      {mutation.isError && (
        <div role="alert" className="space-y-3 text-sm">
          <p className="text-destructive">{mutation.error.message}</p>
          {uncertain ? (
            <Button variant="outline" onClick={() => mutation.mutate(mutation.variables)}>
              Retry this decision
            </Button>
          ) : (
            <Button
              variant="ghost"
              onClick={() => {
                refresh().catch(reportError);
              }}
            >
              Refresh review
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
function AccountChoice({
  disabled,
  onChoose,
}: {
  disabled: boolean;
  onChoose: (id: typeof AccountId.Type) => void;
}) {
  const { data: accounts } = useSuspenseQuery(accountsQueryOptions());
  const id = useId();
  const [accountId, setAccountId] = useState<typeof AccountId.Type | null>(null);
  return (
    <div className="space-y-4">
      <Label htmlFor={id}>Account for this file</Label>
      <Select value={accountId} onValueChange={setAccountId} disabled={disabled}>
        <SelectTrigger id={id}>
          <SelectValue placeholder="Choose an account" />
        </SelectTrigger>
        <SelectContent>
          {accounts.map((account) => (
            <SelectItem key={account.id} value={account.id}>
              {account.label} · {account.currency}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex flex-wrap gap-3">
        <Button
          disabled={disabled || !accountId}
          onClick={() => {
            if (accountId) onChoose(accountId);
          }}
        >
          Confirm account
        </Button>
        <CreateAccountDialog />
      </div>
    </div>
  );
}

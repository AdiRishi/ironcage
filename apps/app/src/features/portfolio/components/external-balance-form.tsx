import {
  ExternalAccount,
  Outcome,
  RecordExternalBalanceInput,
  type ExternalAccount as ExternalAccountView,
} from "@ironcage/contracts/schema";
import { Aud, CalendarDate, newRequestId } from "@ironcage/domain";
import { Button } from "@ironcage/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@ironcage/ui/components/card";
import { Input } from "@ironcage/ui/components/input";
import { Label } from "@ironcage/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ironcage/ui/components/select";
import { useQueryClient } from "@tanstack/react-query";
import { BigDecimal, Schema } from "effect";
import { useState } from "react";

import { keys } from "@/data/keys";
import { describeError } from "@/features/money/format";
import { recordExternalBalance } from "@/server/portfolio";

const encodeInput = Schema.encodeSync(RecordExternalBalanceInput);
const decodeOutcome = Schema.decodeUnknownSync(Outcome(ExternalAccount));
const decodeAud = Schema.decodeUnknownSync(Aud);
const decodeDate = Schema.decodeUnknownSync(CalendarDate);

export function ExternalBalanceForm({
  accounts,
}: {
  readonly accounts: readonly ExternalAccountView[];
}) {
  const queryClient = useQueryClient();
  const [accountId, setAccountId] = useState("new");
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<"asset" | "liability">("asset");
  const [amount, setAmount] = useState("");
  const [balanceDate, setBalanceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  const chooseAccount = (value: string | null) => {
    const selected = accounts.find((account) => account.id === value);
    setAccountId(value ?? "new");
    setLabel(selected?.label ?? "");
    setKind(selected?.kind ?? "asset");
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    try {
      const magnitude = BigDecimal.abs(decodeAud(amount));
      const balance = decodeAud(
        BigDecimal.format(kind === "liability" ? BigDecimal.negate(magnitude) : magnitude),
      );
      const selected = accounts.find((account) => account.id === accountId);
      const outcome = decodeOutcome(
        await recordExternalBalance({
          data: encodeInput({
            requestId: newRequestId(),
            accountId: selected?.id ?? null,
            label,
            kind,
            balance,
            balanceDate: decodeDate(balanceDate),
          }),
        }),
      );
      if (outcome.outcome === "error") {
        setError(describeError(outcome.error));
      } else {
        setAccountId(outcome.value.id);
        setLabel(outcome.value.label);
        setAmount("");
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: keys.wealth() }),
          queryClient.invalidateQueries({ queryKey: keys.externalAccounts() }),
        ]);
      }
    } catch (cause) {
      setError(`Enter a valid AUD amount and date. ${String(cause)}`);
    } finally {
      setPending(false);
    }
  };

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>External balance</CardTitle>
        <CardDescription>Add an asset or liability that Money does not import.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => void submit(event)}>
          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label htmlFor="external-account">Account</Label>
            <Select value={accountId} onValueChange={chooseAccount}>
              <SelectTrigger id="external-account" className="w-full">
                <SelectValue placeholder="Choose an account" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new">New external account</SelectItem>
                {accounts
                  .filter((account) => !account.archived)
                  .map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.label}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="external-label">Label</Label>
            <Input
              id="external-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="external-kind">Kind</Label>
            <Select
              value={kind}
              onValueChange={(value) => setKind(value === "liability" ? "liability" : "asset")}
            >
              <SelectTrigger id="external-kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="asset">Asset</SelectItem>
                <SelectItem value="liability">Liability</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="external-amount">Balance (AUD)</Label>
            <Input
              id="external-amount"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="10000.00"
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="external-date">Balance date</Label>
            <Input
              id="external-date"
              type="date"
              value={balanceDate}
              onChange={(event) => setBalanceDate(event.target.value)}
              required
            />
          </div>
          {error === undefined ? null : (
            <p className="text-sm text-destructive sm:col-span-2">{error}</p>
          )}
          <Button type="submit" disabled={pending} className="sm:col-span-2">
            {pending ? "Recording…" : "Record balance"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

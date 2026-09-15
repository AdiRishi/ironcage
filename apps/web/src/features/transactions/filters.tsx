import { type Account, PostingFilter } from "@repo/contracts/finance";
import { formatDecimal, parseMoney } from "@repo/finance";
import { useForm } from "@tanstack/react-form";
import { Effect, Schema, type Types } from "effect";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function TransactionFilters({
  filter,
  accounts,
  onApply,
}: {
  filter: typeof PostingFilter.Type;
  accounts: ReadonlyArray<Account>;
  onApply: (filter: typeof PostingFilter.Type) => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const defaults = {
    accountId: filter.accountId ?? "",
    currency: filter.currency ?? "",
    from: filter.from ?? "",
    to: filter.to ?? "",
    minimum: filter.minimum
      ? formatDecimal({ minor: BigInt(filter.minimum), currency: filter.currency ?? "AUD" })
      : "",
    maximum: filter.maximum
      ? formatDecimal({ minor: BigInt(filter.maximum), currency: filter.currency ?? "AUD" })
      : "",
    description: filter.description ?? "",
    needsReview: filter.needsReview === undefined ? "all" : filter.needsReview ? "yes" : "no",
  };
  const form = useForm({
    defaultValues: defaults,
    onSubmit: async ({ value }) => {
      setError(null);
      if ((value.minimum || value.maximum) && !value.currency) {
        setError("Choose a currency for the amount range.");
        return;
      }
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const input: Types.Mutable<typeof PostingFilter.Encoded> = {};
          if (filter.importId) input.importId = filter.importId;
          if (value.accountId) input.accountId = value.accountId;
          if (value.currency) input.currency = value.currency;
          if (value.from) input.from = value.from;
          if (value.to) input.to = value.to;
          if (value.minimum)
            input.minimum = (yield* parseMoney(value.minimum, value.currency)).minor.toString();
          if (value.maximum)
            input.maximum = (yield* parseMoney(value.maximum, value.currency)).minor.toString();
          if (value.description) input.description = value.description;
          if (value.needsReview !== "all") input.needsReview = value.needsReview === "yes";
          return yield* Schema.decodeEffect(PostingFilter)(input);
        }).pipe(Effect.result),
      );
      if (result._tag === "Failure") {
        setError(result.failure.message);
        return;
      }
      if (result.success.from && result.success.to && result.success.from > result.success.to) {
        setError("The start date must be on or before the end date.");
        return;
      }
      if (
        result.success.minimum &&
        result.success.maximum &&
        BigInt(result.success.minimum) > BigInt(result.success.maximum)
      ) {
        setError("The minimum amount must be at most the maximum amount.");
        return;
      }
      await onApply(result.success);
    },
  });
  return (
    <form
      className="space-y-4 rounded-lg border p-5"
      onSubmit={(event) => {
        event.preventDefault();
        form.handleSubmit().catch(reportError);
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <form.Field name="description">
          {(field) => (
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Input
                id="description"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                placeholder="Search bank descriptions"
              />
            </div>
          )}
        </form.Field>
        <form.Field name="accountId">
          {(field) => (
            <div className="space-y-2">
              <Label htmlFor="filter-account">Account</Label>
              <Select
                items={[
                  { value: "", label: "All accounts" },
                  ...accounts.map((account) => ({ value: account.id, label: account.label })),
                ]}
                value={field.state.value}
                onValueChange={(value) => {
                  if (value !== null) field.handleChange(value);
                }}
              >
                <SelectTrigger id="filter-account">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All accounts</SelectItem>
                  {accounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.label}
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
              <Label htmlFor="filter-currency">Currency</Label>
              <Input
                id="filter-currency"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value.toUpperCase())}
                placeholder="All currencies"
                pattern="[A-Z]{3}"
                maxLength={3}
                list="filter-currencies"
              />
              <datalist id="filter-currencies">
                {[...new Set(accounts.map((account) => account.currency))].map((currency) => (
                  <option key={currency} value={currency}>
                    {currency}
                  </option>
                ))}
              </datalist>
            </div>
          )}
        </form.Field>
        <form.Field name="needsReview">
          {(field) => (
            <div className="space-y-2">
              <Label htmlFor="filter-review">Source review</Label>
              <Select
                items={{ all: "All transactions", yes: "Needs review", no: "No open review" }}
                value={field.state.value}
                onValueChange={(value) => {
                  if (value) field.handleChange(value);
                }}
              >
                <SelectTrigger id="filter-review">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All transactions</SelectItem>
                  <SelectItem value="yes">Needs review</SelectItem>
                  <SelectItem value="no">No open review</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </form.Field>
        {(
          [
            { name: "from", label: "Posted from", type: "date" },
            { name: "to", label: "Posted through", type: "date" },
            { name: "minimum", label: "Minimum amount", type: "text" },
            { name: "maximum", label: "Maximum amount", type: "text" },
          ] as const
        ).map(({ name, label, type }) => (
          <form.Field key={name} name={name}>
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor={`filter-${name}`}>{label}</Label>
                <Input
                  id={`filter-${name}`}
                  type={type}
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder={type === "text" ? "e.g. -100.00" : undefined}
                />
              </div>
            )}
          </form.Field>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-3">
        <Button type="submit" variant="outline">
          Apply filters
        </Button>
        {Object.keys(filter).length > 0 && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              onApply({}).catch(reportError);
            }}
          >
            Clear filters
          </Button>
        )}
      </div>
    </form>
  );
}

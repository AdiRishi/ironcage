import type { CategorySummary, ReviewQueueEntry } from "@ironcage/contracts/schema";
import type { CategoryId } from "@ironcage/domain";
import { Alert, AlertDescription, AlertTitle } from "@ironcage/ui/components/alert";
import { Badge } from "@ironcage/ui/components/badge";
import { Button } from "@ironcage/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@ironcage/ui/components/card";
import { Checkbox } from "@ironcage/ui/components/checkbox";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@ironcage/ui/components/empty";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@ironcage/ui/components/select";
import { Spinner } from "@ironcage/ui/components/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ironcage/ui/components/tooltip";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleAlertIcon, InboxIcon, SparklesIcon } from "lucide-react";
import { useState } from "react";

import { keys } from "@/data/keys";
import {
  decodeCategorizeOutcome,
  encodeCategorizePayload,
  mintRequestId,
} from "@/features/money/codec";
import { describeError, formatAud, formatDay } from "@/features/money/format";
import { categorizeTransactions } from "@/server/money";

type Staged = { readonly categoryId: CategoryId; readonly rule: boolean };

function CategorySelect({
  categories,
  value,
  onChange,
}: {
  readonly categories: readonly CategorySummary[];
  readonly value: CategoryId | null;
  readonly onChange: (categoryId: CategoryId) => void;
}) {
  const expenses = categories.filter((category) => category.kind === "expense");
  const incomes = categories.filter((category) => category.kind === "income");
  const selected = categories.find((category) => category.id === value);

  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (typeof next === "string") {
          const match = categories.find((category) => category.id === next);
          if (match !== undefined) onChange(match.id);
        }
      }}
    >
      <SelectTrigger size="sm" className="min-w-40" aria-label="Category">
        <SelectValue placeholder="Choose…">{selected?.name}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Spending</SelectLabel>
          {expenses.map((category) => (
            <SelectItem key={category.id} value={category.id}>
              {category.name}
            </SelectItem>
          ))}
        </SelectGroup>
        {incomes.length > 0 ? (
          <SelectGroup>
            <SelectLabel>Income</SelectLabel>
            {incomes.map((category) => (
              <SelectItem key={category.id} value={category.id}>
                {category.name}
              </SelectItem>
            ))}
          </SelectGroup>
        ) : null}
      </SelectContent>
    </Select>
  );
}

/**
 * The queue of transactions no rule recognized. Choices stage locally and
 * apply in one batch; ticking "always" turns a correction into a forward
 * rule for that payee, which the product treats as the main way rules exist.
 */
export function ReviewQueue({
  entries,
  categories,
}: {
  readonly entries: readonly ReviewQueueEntry[];
  readonly categories: readonly CategorySummary[];
}) {
  const queryClient = useQueryClient();
  const [staged, setStaged] = useState<Record<string, Staged>>({});

  const assignable = categories.filter((category) => !category.system && !category.archived);
  const ordered = [...entries].sort((a, b) => b.postedDate.localeCompare(a.postedDate));
  const stagedCount = Object.keys(staged).length;

  const apply = useMutation({
    mutationFn: async () => {
      const changes = entries
        .filter((entry) => staged[entry.transactionId] !== undefined)
        .map((entry) => ({
          transactionId: entry.transactionId,
          splits: [
            { categoryId: staged[entry.transactionId]!.categoryId, amount: entry.amount },
          ],
        }));
      const createRules = entries
        .filter((entry) => staged[entry.transactionId]?.rule === true && entry.payee !== "")
        .map((entry) => ({
          predicate: { payeeEquals: entry.payee },
          categoryId: staged[entry.transactionId]!.categoryId,
        }));
      return decodeCategorizeOutcome(
        await categorizeTransactions({
          data: encodeCategorizePayload({ requestId: mintRequestId(), changes, createRules }),
        }),
      );
    },
    onSuccess: (outcome) => {
      if (outcome.outcome === "ok") {
        setStaged({});
        void queryClient.invalidateQueries({ queryKey: keys.moneyAll() });
      }
    },
  });

  if (entries.length === 0) {
    return (
      <Card>
        <CardContent>
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <InboxIcon />
              </EmptyMedia>
              <EmptyTitle>Nothing waiting on you</EmptyTitle>
              <EmptyDescription>
                When an import lands rows that no rule recognizes, they queue here until you file
                them.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </CardContent>
      </Card>
    );
  }

  const suggestions = ordered.filter(
    (entry) => entry.suggestion !== null && staged[entry.transactionId] === undefined,
  );
  const applyError =
    apply.data?.outcome === "error"
      ? describeError(apply.data.error)
      : apply.error !== null
        ? String(apply.error)
        : undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-lg tracking-tight">
          {ordered.length} to categorize
        </CardTitle>
        <CardDescription>
          Every AI suggestion waits for your decision — nothing applies itself. The bank's own
          narrative never changes, whatever you file a row under.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        {suggestions.length > 1 ? (
          <div className="mb-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setStaged((current) => {
                  const next = { ...current };
                  for (const entry of suggestions) {
                    next[entry.transactionId] = {
                      categoryId: entry.suggestion!.categoryId,
                      rule: false,
                    };
                  }
                  return next;
                })
              }
            >
              <SparklesIcon className="text-ai" />
              Stage all {suggestions.length} suggestions
            </Button>
          </div>
        ) : null}
        {ordered.map((entry) => {
          const stagedEntry = staged[entry.transactionId];
          return (
            <div
              key={entry.transactionId}
              className="flex flex-wrap items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-row-hover"
            >
              <span className="w-24 shrink-0 font-mono text-xs text-muted-foreground">
                {formatDay(entry.postedDate)}
              </span>
              <div className="min-w-0 flex-1">
                <span className="block truncate text-sm" title={entry.narrative}>
                  {entry.payee === "" ? entry.narrative : entry.payee}
                </span>
                <span className="block truncate font-mono text-xs text-ink-faint">
                  {entry.productLabel}
                  {entry.payee === "" ? "" : ` · ${entry.narrative}`}
                </span>
              </div>
              <span className="w-28 shrink-0 text-right font-mono text-sm tabular-nums">
                {formatAud(entry.amount, { sign: "always" })}
              </span>
              {entry.suggestion !== null && stagedEntry === undefined ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Badge
                        render={
                          <button
                            type="button"
                            onClick={() =>
                              setStaged((current) => ({
                                ...current,
                                [entry.transactionId]: {
                                  categoryId: entry.suggestion!.categoryId,
                                  rule: false,
                                },
                              }))
                            }
                          />
                        }
                        variant="outline"
                        className="cursor-pointer border-ai/50 text-ai hover:bg-ai/10"
                      >
                        <SparklesIcon />
                        {entry.suggestion.categoryName}
                      </Badge>
                    }
                  />
                  <TooltipContent className="max-w-72">
                    {entry.suggestion.rationale} — click to stage.
                  </TooltipContent>
                </Tooltip>
              ) : null}
              <CategorySelect
                categories={assignable}
                value={stagedEntry?.categoryId ?? null}
                onChange={(categoryId) =>
                  setStaged((current) => ({
                    ...current,
                    [entry.transactionId]: {
                      categoryId,
                      rule: current[entry.transactionId]?.rule ?? false,
                    },
                  }))
                }
              />
              {entry.payee === "" ? (
                <span className="w-16" />
              ) : (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <label className="flex w-16 items-center gap-1.5 text-xs text-muted-foreground">
                        <Checkbox
                          disabled={stagedEntry === undefined}
                          checked={stagedEntry?.rule ?? false}
                          onCheckedChange={(checked) =>
                            setStaged((current) => {
                              const existing = current[entry.transactionId];
                              return existing === undefined
                                ? current
                                : {
                                    ...current,
                                    [entry.transactionId]: {
                                      ...existing,
                                      rule: checked === true,
                                    },
                                  };
                            })
                          }
                        />
                        always
                      </label>
                    }
                  />
                  <TooltipContent>
                    From now on, file "{entry.payee}" this way automatically. The rule appears
                    below and can be removed.
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          );
        })}
        {applyError === undefined ? null : (
          <Alert variant="destructive" className="mt-3">
            <CircleAlertIcon />
            <AlertTitle>Nothing was applied</AlertTitle>
            <AlertDescription>{applyError}</AlertDescription>
          </Alert>
        )}
      </CardContent>
      <CardFooter className="justify-between border-t pt-4">
        <span className="font-mono text-xs text-muted-foreground">
          {stagedCount} of {ordered.length} staged
        </span>
        <Button disabled={stagedCount === 0 || apply.isPending} onClick={() => apply.mutate()}>
          {apply.isPending ? <Spinner /> : null}
          Apply {stagedCount === 0 ? "" : `${stagedCount} `}
          {stagedCount === 1 ? "assignment" : "assignments"}
        </Button>
      </CardFooter>
    </Card>
  );
}

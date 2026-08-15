import type { CategorySummary, LedgerEntry } from "@ironcage/contracts/schema";
import type { CategoryId, SplitProvenance } from "@ironcage/domain";
import { Alert, AlertDescription, AlertTitle } from "@ironcage/ui/components/alert";
import { Button } from "@ironcage/ui/components/button";
import { Card, CardContent, CardFooter } from "@ironcage/ui/components/card";
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
import { cn } from "@ironcage/ui/lib/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleAlertIcon, InboxIcon, SparklesIcon, UserIcon, ZapIcon } from "lucide-react";
import { useState, type SetStateAction } from "react";

import { keys } from "@/data/keys";
import { mintRequestId } from "@/data/request";
import { describeError, formatAud, formatDay } from "@/features/money/format";
import { decodeCategorizeOutcome, encodeCategorizePayload } from "@/features/money/transport";
import { categorizeTransactions } from "@/server/money";

type Staged = { readonly categoryId: CategoryId; readonly rule: boolean };

/** Who filed the row, at a glance — the AI's mark carries its rationale. */
function FiledBy({ entry }: { readonly entry: LedgerEntry }) {
  const marks: Record<
    SplitProvenance,
    { icon: React.ReactNode; label: string; className: string } | null
  > = {
    system: null,
    ai: {
      icon: <SparklesIcon className="size-3" />,
      label: entry.rationale === null ? "Filed by AI" : `Filed by AI — ${entry.rationale}`,
      className: "text-ai",
    },
    rule: {
      icon: <ZapIcon className="size-3" />,
      label: "Filed by a rule",
      className: "text-ink-faint",
    },
    manual: {
      icon: <UserIcon className="size-3" />,
      label: "Filed by you",
      className: "text-ink-faint",
    },
  };
  const mark = marks[entry.filedBy];
  if (mark === null) return <span className="w-3" />;
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span className={cn("inline-flex", mark.className)} aria-label={mark.label} />}
      >
        {mark.icon}
      </TooltipTrigger>
      <TooltipContent className="max-w-72">{mark.label}</TooltipContent>
    </Tooltip>
  );
}

function CategorySelect({
  categories,
  value,
  placeholder,
  onChange,
}: {
  readonly categories: readonly CategorySummary[];
  readonly value: CategoryId | null;
  readonly placeholder: string;
  readonly onChange: (categoryId: CategoryId) => void;
}) {
  const expenses = categories.filter((category) => category.kind === "expense");
  const incomes = categories.filter((category) => category.kind === "income");
  const selected = categories.find((category) => category.id === value);

  return (
    <Select
      value={value}
      onValueChange={(next) => {
        const match = categories.find((category) => category.id === next);
        if (match !== undefined) onChange(match.id);
      }}
    >
      <SelectTrigger
        size="sm"
        className={cn(
          "h-7 min-w-36 border-transparent bg-transparent px-1.5 text-xs shadow-none hover:border-input dark:bg-transparent",
          value === null && "text-warning",
        )}
        aria-label="Category"
      >
        <SelectValue placeholder={placeholder}>{selected?.name}</SelectValue>
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
 * The ledger: every transaction in scope, its category, and who filed it.
 * Filing is the system's job — rules first, then the AI — so the operator's
 * work here is inspection: change a row that landed wrong, and optionally
 * make that correction a rule. Changes stage locally and apply in one batch.
 */
export function Ledger({
  scope,
  entries,
  categories,
  emptyTitle,
  emptyDescription,
}: {
  readonly scope: string;
  readonly entries: readonly LedgerEntry[];
  readonly categories: readonly CategorySummary[];
  readonly emptyTitle: string;
  readonly emptyDescription: string;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<{
    readonly scope: string;
    readonly changes: Record<string, Staged>;
  }>({ scope, changes: {} });
  const staged = draft.scope === scope ? draft.changes : {};
  const setStaged = (update: SetStateAction<Record<string, Staged>>) =>
    setDraft((current) => {
      const changes = current.scope === scope ? current.changes : {};
      return {
        scope,
        changes: typeof update === "function" ? update(changes) : update,
      };
    });

  const assignable = categories.filter((category) => !category.system && !category.archived);
  const stagedCount = Object.keys(staged).length;

  const apply = useMutation({
    mutationFn: async () => {
      const changes = entries
        .filter((entry) => staged[entry.transactionId] !== undefined)
        .map((entry) => ({
          transactionId: entry.transactionId,
          splits: [{ categoryId: staged[entry.transactionId]!.categoryId, amount: entry.amount }],
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
    onSuccess: async (outcome) => {
      if (outcome.outcome === "ok") {
        setStaged({});
        await queryClient.invalidateQueries({ queryKey: keys.moneyAll() });
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
              <EmptyTitle>{emptyTitle}</EmptyTitle>
              <EmptyDescription>{emptyDescription}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </CardContent>
      </Card>
    );
  }

  const applyError =
    apply.data?.outcome === "error"
      ? describeError(apply.data.error)
      : apply.error !== null
        ? String(apply.error)
        : undefined;

  return (
    <Card className="gap-0 py-0">
      <CardContent className="px-2 py-2">
        <div className="flex flex-col">
          {entries.map((entry) => {
            const stagedEntry = staged[entry.transactionId];
            const current = entry.filedBy === "system" ? null : entry.splits[0]!.categoryId;
            const value = stagedEntry?.categoryId ?? current;
            const changed = stagedEntry !== undefined && stagedEntry.categoryId !== current;
            const split = entry.splits.length > 1;

            return (
              <div
                key={entry.transactionId}
                className={cn(
                  "grid grid-cols-[5.5rem_1fr_7rem_1rem_minmax(9rem,11rem)_4.5rem] items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-row-hover",
                  changed && "bg-accent/60",
                )}
              >
                <span className="font-mono text-xs text-muted-foreground">
                  {formatDay(entry.postedDate)}
                </span>
                <div className="min-w-0">
                  <span className="block truncate text-sm" title={entry.narrative}>
                    {entry.payee === "" ? entry.narrative : entry.payee}
                  </span>
                  <span className="block truncate font-mono text-[11px] text-ink-faint">
                    {entry.productLabel}
                    {entry.payee === "" || entry.payee === entry.narrative
                      ? ""
                      : ` · ${entry.narrative}`}
                  </span>
                </div>
                <span className="text-right font-mono text-sm tabular-nums">
                  {formatAud(entry.amount, { sign: "always" })}
                </span>
                <FiledBy entry={entry} />
                {split ? (
                  <Tooltip>
                    <TooltipTrigger
                      render={<span className="truncate text-xs text-muted-foreground" />}
                    >
                      {entry.splits.map((s) => s.categoryName).join(" + ")}
                    </TooltipTrigger>
                    <TooltipContent>
                      {entry.splits
                        .map((s) => `${s.categoryName} ${formatAud(s.amount)}`)
                        .join(" · ")}
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <CategorySelect
                    categories={assignable}
                    value={value}
                    placeholder="Needs a hand…"
                    onChange={(categoryId) =>
                      setStaged((prior) =>
                        categoryId === current
                          ? Object.fromEntries(
                              Object.entries(prior).filter(([id]) => id !== entry.transactionId),
                            )
                          : {
                              ...prior,
                              [entry.transactionId]: {
                                categoryId,
                                rule: prior[entry.transactionId]?.rule ?? false,
                              },
                            },
                      )
                    }
                  />
                )}
                {entry.payee === "" || split ? (
                  <span />
                ) : (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground" />
                      }
                    >
                      <Checkbox
                        aria-label={`Always file ${entry.payee} this way`}
                        disabled={stagedEntry === undefined}
                        checked={stagedEntry?.rule ?? false}
                        onCheckedChange={(checked) =>
                          setStaged((prior) => {
                            const existing = prior[entry.transactionId];
                            return existing === undefined
                              ? prior
                              : {
                                  ...prior,
                                  [entry.transactionId]: { ...existing, rule: checked === true },
                                };
                          })
                        }
                      />
                      always
                    </TooltipTrigger>
                    <TooltipContent>
                      From now on, file "{entry.payee}" this way before the AI sees it. The rule
                      appears below and can be removed.
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
            );
          })}
        </div>
        {applyError === undefined ? null : (
          <Alert variant="destructive" className="mt-3">
            <CircleAlertIcon />
            <AlertTitle>Nothing was applied</AlertTitle>
            <AlertDescription>{applyError}</AlertDescription>
          </Alert>
        )}
      </CardContent>
      <CardFooter
        className={cn(
          "sticky bottom-0 justify-between border-t bg-card/95 px-4 py-2.5 backdrop-blur",
          stagedCount === 0 && "hidden",
        )}
      >
        <span className="font-mono text-xs text-muted-foreground">
          {stagedCount} {stagedCount === 1 ? "change" : "changes"} staged
        </span>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setStaged({})}
            disabled={apply.isPending}
          >
            Discard
          </Button>
          <Button size="sm" disabled={apply.isPending} onClick={() => apply.mutate()}>
            {apply.isPending ? <Spinner /> : null}
            Apply {stagedCount === 1 ? "change" : "changes"}
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}

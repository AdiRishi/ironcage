import type { LedgerScope } from "@ironcage/contracts/schema";
import { Skeleton } from "@ironcage/ui/components/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@ironcage/ui/components/tabs";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Schema } from "effect";

import { CategoriesDialog } from "@/features/money/components/categories-dialog";
import { EvidenceLine } from "@/features/money/components/evidence-line";
import { Ledger } from "@/features/money/components/ledger";
import { MonthSwitcher } from "@/features/money/components/month-switcher";
import { RetryCategorization } from "@/features/money/components/retry-categorization";
import { RulesCard } from "@/features/money/components/rules-card";
import { TransferQueue } from "@/features/money/components/transfer-queue";
import { formatMonth } from "@/features/money/format";
import {
  analysisQuery,
  categoriesQuery,
  ledgerQuery,
  rulesQuery,
  transfersQuery,
} from "@/features/money/queries";

const TransactionSearch = Schema.Struct({
  view: Schema.optionalKey(Schema.Literals(["attention", "ai", "month"])),
  month: Schema.optionalKey(Schema.String),
  category: Schema.optionalKey(Schema.String),
});
type Search = typeof TransactionSearch.Type;
type View = NonNullable<Search["view"]>;

const decodeTransactionSearch = Schema.decodeUnknownSync(TransactionSearch);

const scopeOf = (search: Search): LedgerScope =>
  search.view === "month" && search.month !== undefined
    ? { kind: "month", month: search.month }
    : { kind: "attention" };

export const Route = createFileRoute("/money/transactions")({
  validateSearch: decodeTransactionSearch,
  loaderDeps: ({ search }) => ({ scope: scopeOf(search) }),
  loader: ({ context, deps }) =>
    Promise.all([
      context.queryClient.ensureQueryData(ledgerQuery(deps.scope)),
      context.queryClient.ensureQueryData(categoriesQuery),
      context.queryClient.ensureQueryData(transfersQuery),
      context.queryClient.ensureQueryData(rulesQuery),
      context.queryClient.ensureQueryData(analysisQuery),
    ]),
  component: MoneyTransactions,
});

/**
 * The ledger with three ways in: what still needs a hand, what the AI filed
 * (open to change), and any month in full — the drill-down every aggregate
 * on Spending opens into.
 */
function MoneyTransactions() {
  const navigate = Route.useNavigate();
  const search = Route.useSearch();
  const view: View = search.view ?? "attention";
  const selectedMonth = search.month;
  const scope = scopeOf(search);

  const ledger = useQuery(ledgerQuery(scope));
  const categories = useQuery(categoriesQuery);
  const transfers = useQuery(transfersQuery);
  const rules = useQuery(rulesQuery);
  const analysis = useQuery(analysisQuery);

  const months = [...(analysis.data?.months ?? [])].sort((a, b) => a.month.localeCompare(b.month));
  const latestMonth = months[months.length - 1]?.month;

  const go = (next: Search) => {
    navigate({ search: next, replace: true, resetScroll: false }).catch(() => undefined);
  };

  const rows = (ledger.data ?? []).filter((entry) => {
    if (view === "attention") return entry.filedBy === "system";
    if (view === "ai") return entry.filedBy === "ai";
    return search.category === undefined
      ? true
      : entry.splits.some((split) => split.categoryId === search.category);
  });
  const attentionCount = (ledger.data ?? []).filter((entry) => entry.filedBy === "system").length;
  const categoryName =
    search.category === undefined
      ? undefined
      : categories.data?.find((category) => category.id === search.category)?.name;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <EvidenceLine />
        {categories.isSuccess ? <CategoriesDialog categories={categories.data} /> : null}
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <Tabs
          value={view}
          onValueChange={(next) => {
            if (next === "month") {
              go({ view: "month", month: search.month ?? latestMonth ?? "" });
            } else if (next === "ai" || next === "attention") {
              go({ view: next });
            }
          }}
        >
          <TabsList variant="line">
            <TabsTrigger value="attention">
              Needs a hand
              {scope.kind === "attention" && attentionCount > 0 ? (
                <span className="ml-1.5 font-mono text-[11px] text-warning">
                  · {attentionCount}
                </span>
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="ai">Filed by AI</TabsTrigger>
            <TabsTrigger value="month">By month</TabsTrigger>
          </TabsList>
        </Tabs>
        {view === "month" && selectedMonth !== undefined && months.length > 0 ? (
          <div className="flex items-center gap-2">
            <span className="font-display text-base font-semibold tracking-tight">
              {formatMonth(selectedMonth)}
            </span>
            <MonthSwitcher
              months={months}
              selected={selectedMonth}
              onSelect={(month) => {
                if (search.category === undefined) {
                  go({ view: "month", month });
                } else {
                  go({ view: "month", month, category: search.category });
                }
              }}
            />
            {categoryName === undefined ? null : (
              <button
                type="button"
                className="font-mono text-xs text-muted-foreground underline-offset-4 hover:underline"
                onClick={() => go({ view: "month", month: selectedMonth })}
              >
                {categoryName} only · clear
              </button>
            )}
          </div>
        ) : null}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-3">
          {view === "attention" ? <RetryCategorization transactionCount={attentionCount} /> : null}
          <span className="font-mono text-[11px] text-ink-faint">
            {view === "attention"
              ? "rows no rule or AI answer reached — file these"
              : view === "ai"
                ? "change any that landed wrong; ticking always makes a rule"
                : `${rows.length} ${rows.length === 1 ? "row" : "rows"}`}
          </span>
        </div>
      </div>
      {ledger.isPending || categories.isPending ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : ledger.isError ? (
        <p className="text-sm text-destructive">Ledger unavailable — {String(ledger.error)}</p>
      ) : categories.isError ? (
        <p className="text-sm text-destructive">
          Categories unavailable — {String(categories.error)}
        </p>
      ) : (
        <Ledger
          scope={`${view}:${scope.kind === "month" ? scope.month : "attention"}:${search.category ?? "all"}`}
          entries={rows}
          categories={categories.data}
          emptyTitle={
            view === "attention"
              ? "Everything is filed"
              : view === "ai"
                ? "Nothing filed by AI yet"
                : "No transactions here"
          }
          emptyDescription={
            view === "attention"
              ? "Rules and the AI have a category on every row. Anything they can't place lands here."
              : view === "ai"
                ? "After an import, rows no rule recognized are filed by the AI and listed here for you to inspect."
                : "Nothing posted in this scope."
          }
        />
      )}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        {transfers.isPending ? (
          <Skeleton className="h-40 w-full rounded-xl" />
        ) : transfers.isError ? (
          <p className="text-sm text-destructive">
            Transfers unavailable — {String(transfers.error)}
          </p>
        ) : (
          <TransferQueue unresolved={transfers.data.unresolved} matches={transfers.data.matches} />
        )}
        {rules.isPending ? (
          <Skeleton className="h-32 w-full rounded-xl" />
        ) : rules.isError ? (
          <p className="text-sm text-destructive">Rules unavailable — {String(rules.error)}</p>
        ) : (
          <RulesCard rules={rules.data} />
        )}
      </div>
    </div>
  );
}

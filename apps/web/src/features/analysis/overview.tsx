import type { OverviewInput, OverviewResult } from "@repo/contracts/finance";
import { formatMoney } from "@repo/finance";
import { useSuspenseQuery } from "@tanstack/react-query";

import { accountsQueryOptions } from "@/features/accounts/queries";

import { Coverage } from "./coverage";
import { overviewQuery } from "./queries";
import { OverviewSelection } from "./selection";
export function ResultContext({ result }: { result: OverviewResult }) {
  return (
    <p className="rounded-md border bg-secondary p-3 text-sm">
      {result.period.start} to {result.period.endExclusive}, end excluded.{" "}
      {result.basis === "spending"
        ? "Purchase dates where known, otherwise posted dates"
        : "Posted dates"}
      . {result.currency}.{" "}
      {result.coverage.accounts.map((item) => item.account.label).join(", ") || "No accounts"}.
      Calculated {result.calculatedAt}.
    </p>
  );
}
export function OverviewPage({
  input,
  onApply,
}: {
  input: OverviewInput;
  onApply: (input: OverviewInput) => Promise<void>;
}) {
  const { data: result } = useSuspenseQuery(overviewQuery(input));
  const { data: accounts } = useSuspenseQuery(accountsQueryOptions());
  const complete =
    result.coverage.accounts.length > 0 &&
    result.coverage.accounts.every((account) => account.missing.length === 0);
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold">Your spending, in context</h1>
        <p className="mt-2 text-muted-foreground">
          Costs, income, and account movements from your recorded history.
        </p>
      </header>
      <OverviewSelection
        key={JSON.stringify(input)}
        input={input}
        accounts={accounts}
        onApply={onApply}
      />
      <ResultContext result={result} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[
          { label: "Net personal costs", value: result.netPersonalCosts },
          { label: "Gross costs", value: result.grossCosts },
          { label: "Income", value: result.income },
          { label: "Surplus after costs", value: result.surplus },
          { label: "Cash balance change", value: result.cashBalanceChange },
        ].map(({ label, value }) => (
          <section key={label} className="rounded-lg border bg-card p-5">
            <h2 className="text-sm font-medium">{label}</h2>
            <p className="mt-3 text-2xl font-semibold tabular-nums">
              {value ? formatMoney(value) : "Unavailable"}
            </p>
            {result.coverage.unresolvedCount > 0 && (
              <p className="mt-2 text-xs text-destructive">
                {result.coverage.unresolvedCount} unresolved events may change this result.
              </p>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              {label === "Cash balance change"
                ? "Posted basis, deposit accounts, requires both balance anchors."
                : `${input.basis} basis. ${complete ? "Complete coverage." : "Incomplete coverage, missing accounts and dates below."}`}
            </p>
          </section>
        ))}
      </div>
      <p>
        Purchase count: {result.purchaseCount}. Surplus rate:{" "}
        {result.surplusRate === null ? "Unavailable" : `${result.surplusRate}%`}. Surplus is not
        available cash.
      </p>
      {result.loans.map((loan) => (
        <section key={loan.accountId} className="rounded-lg border p-5">
          <h2 className="font-semibold">{loan.label}: net principal reduction</h2>
          <p className="my-2 text-2xl tabular-nums">
            {loan.netPrincipalReduction ? formatMoney(loan.netPrincipalReduction) : "Unavailable"}
          </p>
          <p>
            Repayments {formatMoney(loan.repayments)}, interest and fees{" "}
            {formatMoney(loan.financingCosts)}. Posted basis.
          </p>
          {loan.netPrincipalReduction && loan.netPrincipalReduction.minor < 0n && (
            <p>Financing costs exceed repayments.</p>
          )}
        </section>
      ))}
      <Coverage coverage={result.coverage} />
    </div>
  );
}

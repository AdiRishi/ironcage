import type { AnalysisQuery, ComparisonResult, GroupBy } from "@repo/contracts/finance";
import { useSuspenseQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { accountsQueryOptions } from "@/features/accounts/queries";
import { referenceDataQuery } from "@/features/events/queries";

import { ContributorsView } from "./contributors";
import { Coverage } from "./coverage";
import { TrendsFilters } from "./filters";
import { formatMetric, measureLabels } from "./labels";
import { contributorsQuery } from "./queries";
import { OverviewSelection } from "./selection";
export function ComparisonHeadline({ result }: { result: ComparisonResult }) {
  return (
    <section className="space-y-4 rounded-lg border bg-card p-5">
      <h2 className="text-xl font-semibold">{measureLabels[result.query.measure]}</h2>
      <p className="text-sm text-muted-foreground">
        {result.query.currency}, {result.query.basis} basis.{" "}
        {result.current.coverage.accounts.map((item) => item.account.label).join(", ") ||
          "No accounts"}
        . Calculated {result.calculatedAt}.
      </p>
      <div className="grid gap-5 sm:grid-cols-3">
        {[
          { label: "Current", period: result.current },
          { label: "Previous", period: result.previous },
        ].map(({ label, period }) => (
          <div key={label}>
            <h3 className="text-sm font-medium">{label}</h3>
            <p className="text-xs text-muted-foreground">
              {period.period.start} to {period.period.endExclusive}, end excluded
            </p>
            <p className="mt-3 text-2xl font-semibold tabular-nums">{formatMetric(period.value)}</p>
            {result.query.normalization === "dailyAverage" && (
              <p className="text-sm">
                Recorded total {formatMetric(period.total)} / {period.days} calendar days.
                {period.value.kind === "unavailable" &&
                  " Daily average unavailable because coverage is incomplete."}
              </p>
            )}
            {period.coverage.accounts.some((account) => account.missing.length > 0) && (
              <p className="mt-2 text-sm text-destructive">
                Incomplete coverage. Missing accounts and dates below.
              </p>
            )}
            {period.coverage.unresolvedCount > 0 && (
              <p className="mt-2 text-sm text-destructive">
                {period.coverage.unresolvedCount} unresolved events may change this result.
              </p>
            )}
          </div>
        ))}
        <div>
          <h3 className="text-sm font-medium">Change</h3>
          <p className="mt-3 text-2xl font-semibold tabular-nums">{formatMetric(result.delta)}</p>
          <p className="text-sm">
            {result.relativeChange === null
              ? result.previous.value.kind !== "unavailable" &&
                result.current.value.kind !== "unavailable"
                ? "New, no prior amount"
                : "Relative change unavailable"
              : `${result.relativeChange}%`}
          </p>
        </div>
      </div>
    </section>
  );
}
export function TrendsPage({
  query,
  groupBy,
  onChange,
}: {
  query: AnalysisQuery;
  groupBy: GroupBy;
  onChange: (query: AnalysisQuery, groupBy: GroupBy) => Promise<void>;
}) {
  const result = useSuspenseQuery(contributorsQuery({ query, groupBy }));
  const { data: accounts } = useSuspenseQuery(accountsQueryOptions());
  const { data: references } = useSuspenseQuery(referenceDataQuery());
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold">What changed?</h1>
          <p className="mt-2 text-muted-foreground">
            Compare periods and follow the difference to its contributors.
          </p>
        </div>
        <Button
          variant="outline"
          disabled={result.isFetching}
          onClick={() => {
            result.refetch().catch(reportError);
          }}
        >
          Refresh
        </Button>
      </header>
      <OverviewSelection
        key={JSON.stringify(query)}
        input={query}
        postedOnly={
          query.measure === "cashBalanceChange" || query.measure === "netPrincipalReduction"
        }
        accounts={accounts}
        onApply={(input) => onChange({ ...query, ...input }, groupBy)}
      />
      <TrendsFilters
        previousPeriod={result.data.comparison.previous.period}
        query={query}
        groupBy={groupBy}
        references={references}
        onChange={onChange}
      />
      <ComparisonHeadline result={result.data.comparison} />
      <ContributorsView result={result.data} />
      <div className="grid gap-5 lg:grid-cols-2">
        <div>
          <h2 className="mb-2 font-medium">Current period</h2>
          <Coverage coverage={result.data.comparison.current.coverage} />
        </div>
        <div>
          <h2 className="mb-2 font-medium">Previous period</h2>
          <Coverage coverage={result.data.comparison.previous.coverage} />
        </div>
      </div>
    </div>
  );
}

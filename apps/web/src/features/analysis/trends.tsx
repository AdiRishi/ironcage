import type { AnalysisQuery, GroupBy } from "@repo/contracts/finance";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { accountsQueryOptions } from "@/features/accounts/queries";
import { referenceDataQuery } from "@/features/events/queries";

import { TrendsFilters } from "./filters";
import { AnalysisNameDialog } from "./name-dialog";
import { contributorsQuery } from "./queries";
import { ComparisonResults } from "./results";
import { OverviewSelection } from "./selection";
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
      <div className="flex flex-wrap items-center gap-4">
        <AnalysisNameDialog action={{ kind: "save", definition: { query, groupBy } }} />
        <Link className="text-sm underline" to="/trends/analyses">
          Saved analyses
        </Link>
      </div>
      <OverviewSelection
        key={JSON.stringify(query)}
        input={query}
        resolvedPeriod={result.data.comparison.current.period}
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
      <ComparisonResults result={result.data} />
    </div>
  );
}

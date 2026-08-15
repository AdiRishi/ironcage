import { Button } from "@ironcage/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@ironcage/ui/components/empty";
import { Skeleton } from "@ironcage/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { BanknoteIcon } from "lucide-react";

import { SuggestionsCard } from "@/features/money/components/anomalies-and-suggestions";
import { CategoryBreakdown } from "@/features/money/components/category-breakdown";
import { EvidenceLine } from "@/features/money/components/evidence-line";
import { MonthHeader } from "@/features/money/components/month-header";
import { SavingsRateTrend } from "@/features/money/components/savings-rate-trend";
import { SpendTrend } from "@/features/money/components/spend-trend";
import { analysisQuery, coverageQuery } from "@/features/money/queries";

export const Route = createFileRoute("/money/")({
  validateSearch: (search): { month?: string } =>
    typeof search.month === "string" ? { month: search.month } : {},
  loaderDeps: () => ({}),
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(analysisQuery),
      context.queryClient.ensureQueryData(coverageQuery),
    ]),
  component: MoneySpending,
});

function MoneySpending() {
  const navigate = Route.useNavigate();
  const search = Route.useSearch();
  const analysis = useQuery(analysisQuery);

  if (analysis.isPending) {
    return (
      <div className="flex flex-col gap-5">
        <Skeleton className="h-4 w-80" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    );
  }

  if (analysis.isError) {
    return (
      <div className="flex flex-col gap-5">
        <EvidenceLine />
        <p className="text-sm text-destructive">Analysis unavailable — {String(analysis.error)}</p>
      </div>
    );
  }

  const months = [...analysis.data.months].sort((a, b) => a.month.localeCompare(b.month));

  if (months.length === 0) {
    return (
      <div className="flex flex-col gap-5">
        <EvidenceLine />
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BanknoteIcon />
            </EmptyMedia>
            <EmptyTitle>No spending record yet</EmptyTitle>
            <EmptyDescription>
              Export CSV and OFX for one account from NetBank and bring them in. Nothing is stored
              until you confirm what the preview shows.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button nativeButton={false} render={<Link to="/money/import" />}>
              Import an export
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    );
  }

  const fallback = months.findLast((month) => month.complete) ?? months[months.length - 1]!;
  const selected = months.find((month) => month.month === search.month) ?? fallback;
  const select = (month: string) => {
    // Navigation failures surface through the router's own error boundary.
    navigate({ search: { month }, replace: true, resetScroll: false }).catch(() => undefined);
  };

  return (
    <div className="flex flex-col gap-5">
      <EvidenceLine />
      <MonthHeader months={months} month={selected} onSelect={select} />
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-4">
          <CategoryBreakdown month={selected} />
          <SpendTrend months={months} selected={selected.month} onSelect={select} />
        </div>
        <div className="flex flex-col gap-4">
          <SavingsRateTrend months={months} />
          <SuggestionsCard
            suggestions={analysis.data.suggestions}
            unavailable={analysis.data.suggestionsUnavailable}
          />
        </div>
      </div>
    </div>
  );
}

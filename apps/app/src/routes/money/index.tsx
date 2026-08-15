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

import { CategoryBreakdown } from "@/features/money/components/category-breakdown";
import { EvidenceLine } from "@/features/money/components/evidence-line";
import { MonthSummary } from "@/features/money/components/month-summary";
import { MonthSwitcher } from "@/features/money/components/month-switcher";
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
      <div className="flex flex-col gap-6">
        <Skeleton className="h-4 w-80" />
        <Skeleton className="h-44 w-full rounded-xl" />
        <Skeleton className="h-56 w-full rounded-xl" />
      </div>
    );
  }

  if (analysis.isError) {
    return (
      <div className="flex flex-col gap-6">
        <EvidenceLine />
        <p className="text-sm text-destructive">Analysis unavailable — {String(analysis.error)}</p>
      </div>
    );
  }

  const months = [...analysis.data.months].sort((a, b) => a.month.localeCompare(b.month));

  if (months.length === 0) {
    return (
      <div className="flex flex-col gap-6">
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
            <Button render={<Link to="/money/import" />}>Import an export</Button>
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
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <EvidenceLine />
        <MonthSwitcher months={months} selected={selected.month} onSelect={select} />
      </div>
      <MonthSummary month={selected} />
      <SpendTrend months={months} selected={selected.month} onSelect={select} />
      <CategoryBreakdown month={selected} />
    </div>
  );
}

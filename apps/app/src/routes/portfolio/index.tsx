import { Skeleton } from "@ironcage/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { WholeWealthView } from "@/features/portfolio/components/whole-wealth";
import { externalAccountsQuery, wealthQuery } from "@/features/portfolio/queries";

export const Route = createFileRoute("/portfolio/")({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(wealthQuery),
      context.queryClient.ensureQueryData(externalAccountsQuery),
    ]),
  component: PortfolioBook,
});

function PortfolioBook() {
  const wealth = useQuery(wealthQuery);
  const accounts = useQuery(externalAccountsQuery);
  if (wealth.isPending || accounts.isPending)
    return <Skeleton className="h-96 w-full rounded-xl" />;
  if (wealth.isError || accounts.isError) {
    return (
      <p className="text-sm text-destructive">
        Whole-of-wealth view unavailable — {String(wealth.error ?? accounts.error)}
      </p>
    );
  }
  return <WholeWealthView wealth={wealth.data} accounts={accounts.data} />;
}

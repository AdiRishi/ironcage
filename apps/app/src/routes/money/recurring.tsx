import { Skeleton } from "@ironcage/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { AnomaliesCard } from "@/features/money/components/anomalies-and-suggestions";
import { EvidenceLine } from "@/features/money/components/evidence-line";
import { RecurringCharges } from "@/features/money/components/recurring-charges";
import { analysisQuery } from "@/features/money/queries";

export const Route = createFileRoute("/money/recurring")({
  loader: ({ context }) => context.queryClient.ensureQueryData(analysisQuery),
  component: MoneyRecurring,
});

function MoneyRecurring() {
  const analysis = useQuery(analysisQuery);

  if (analysis.isPending) {
    return (
      <div className="flex flex-col gap-5">
        <Skeleton className="h-4 w-80" />
        <Skeleton className="h-56 w-full rounded-xl" />
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

  return (
    <div className="flex flex-col gap-5">
      <EvidenceLine />
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[3fr_2fr]">
        <RecurringCharges recurring={analysis.data.recurring} />
        <AnomaliesCard anomalies={analysis.data.anomalies} />
      </div>
    </div>
  );
}

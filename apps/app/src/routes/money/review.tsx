import { Skeleton } from "@ironcage/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { CategoriesDialog } from "@/features/money/components/categories-dialog";
import { EvidenceLine } from "@/features/money/components/evidence-line";
import { ReviewQueue } from "@/features/money/components/review-queue";
import { RulesCard } from "@/features/money/components/rules-card";
import { TransferQueue } from "@/features/money/components/transfer-queue";
import {
  categoriesQuery,
  reviewQuery,
  rulesQuery,
  transfersQuery,
} from "@/features/money/queries";

export const Route = createFileRoute("/money/review")({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(reviewQuery),
      context.queryClient.ensureQueryData(categoriesQuery),
      context.queryClient.ensureQueryData(transfersQuery),
      context.queryClient.ensureQueryData(rulesQuery),
    ]),
  component: MoneyReview,
});

function MoneyReview() {
  const review = useQuery(reviewQuery);
  const categories = useQuery(categoriesQuery);
  const transfers = useQuery(transfersQuery);
  const rules = useQuery(rulesQuery);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <EvidenceLine />
        {categories.isSuccess ? <CategoriesDialog categories={categories.data} /> : null}
      </div>
      {review.isPending || categories.isPending ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : review.isError ? (
        <p className="text-sm text-destructive">Queue unavailable — {String(review.error)}</p>
      ) : categories.isError ? (
        <p className="text-sm text-destructive">
          Categories unavailable — {String(categories.error)}
        </p>
      ) : (
        <ReviewQueue entries={review.data} categories={categories.data} />
      )}
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
  );
}

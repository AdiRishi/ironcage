import { createFileRoute } from "@tanstack/react-router";

import { ReviewQueue } from "@/features/money/components/review-queue";

export const Route = createFileRoute("/money/review")({ component: MoneyReview });

function MoneyReview() {
  return <ReviewQueue />;
}

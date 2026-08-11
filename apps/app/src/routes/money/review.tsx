import { createFileRoute } from "@tanstack/react-router";

import { PagePlaceholder } from "@/components/common/page-placeholder";

export const Route = createFileRoute("/money/review")({ component: MoneyReview });

function MoneyReview() {
  return (
    <PagePlaceholder
      title="Review"
      description="The categorization review queue."
      doc="docs/product/05-money.md"
    />
  );
}

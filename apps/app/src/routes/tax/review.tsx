import { createFileRoute } from "@tanstack/react-router";

import { PagePlaceholder } from "@/components/common/page-placeholder";

export const Route = createFileRoute("/tax/review")({ component: TaxReview });

function TaxReview() {
  return (
    <PagePlaceholder
      title="Review"
      description="Unrecognized and low-confidence events, flagged rather than guessed."
      doc="docs/product/09-tax.md"
    />
  );
}

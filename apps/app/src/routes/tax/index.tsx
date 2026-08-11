import { createFileRoute } from "@tanstack/react-router";

import { PagePlaceholder } from "@/components/common/page-placeholder";

export const Route = createFileRoute("/tax/")({ component: TaxEstimate });

function TaxEstimate() {
  return (
    <PagePlaceholder
      title="Tax"
      description="The running estimate for the current financial year, and how completely its sources are covered."
      doc="docs/product/09-tax.md"
    />
  );
}

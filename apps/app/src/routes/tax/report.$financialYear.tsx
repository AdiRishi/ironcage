import { createFileRoute } from "@tanstack/react-router";

import { PagePlaceholder } from "@/components/common/page-placeholder";

export const Route = createFileRoute("/tax/report/$financialYear")({ component: TaxReport });

function TaxReport() {
  return (
    <PagePlaceholder
      title="Tax report"
      description="The financial-year report, in the shape the figures are filed from."
      doc="docs/product/09-tax.md"
    />
  );
}

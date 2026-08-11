import { createFileRoute } from "@tanstack/react-router";

import { PagePlaceholder } from "@/components/common/page-placeholder";

export const Route = createFileRoute("/tax/sources/$sourceId")({ component: TaxSource });

function TaxSource() {
  return (
    <PagePlaceholder
      title="Tax source"
      description="One source: its sync history and any gaps in it."
      doc="docs/product/09-tax.md"
    />
  );
}

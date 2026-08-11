import { createFileRoute } from "@tanstack/react-router";

import { PagePlaceholder } from "@/components/common/page-placeholder";

export const Route = createFileRoute("/workbench/data")({ component: WorkbenchData });

function WorkbenchData() {
  return (
    <PagePlaceholder
      title="Data"
      description="Candle coverage and the gaps in it."
      doc="docs/product/08-workbench.md"
    />
  );
}

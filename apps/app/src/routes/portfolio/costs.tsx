import { createFileRoute } from "@tanstack/react-router";

import { PagePlaceholder } from "@/components/common/page-placeholder";

export const Route = createFileRoute("/portfolio/costs")({ component: PortfolioCosts });

function PortfolioCosts() {
  return (
    <PagePlaceholder
      title="Costs"
      description="What running the system costs: venue fees, AI spend, and infrastructure."
      doc="docs/product/04-portfolio.md"
    />
  );
}

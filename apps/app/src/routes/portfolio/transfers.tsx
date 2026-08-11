import { createFileRoute } from "@tanstack/react-router";

import { PagePlaceholder } from "@/components/common/page-placeholder";

export const Route = createFileRoute("/portfolio/transfers")({ component: PortfolioTransfers });

function PortfolioTransfers() {
  return (
    <PagePlaceholder
      title="Transfers"
      description="Transfer requests and the arrivals still pending against them."
      doc="docs/product/04-portfolio.md"
    />
  );
}

import { createFileRoute } from "@tanstack/react-router";

import { PagePlaceholder } from "@/components/common/page-placeholder";

export const Route = createFileRoute("/portfolio/capital")({ component: PortfolioCapital });

function PortfolioCapital() {
  return (
    <PagePlaceholder
      title="Capital"
      description="The capital ledger and every allocation act that moved it."
      doc="docs/product/04-portfolio.md"
    />
  );
}

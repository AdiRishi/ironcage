import { createFileRoute } from "@tanstack/react-router";

import { PagePlaceholder } from "@/components/common/page-placeholder";

export const Route = createFileRoute("/portfolio/cage")({ component: PortfolioCage });

function PortfolioCage() {
  return (
    <PagePlaceholder
      title="Cage"
      description="The system cage: total exposure, drawdown from the high-water mark, and venue concentration."
      doc="docs/product/04-portfolio.md"
    />
  );
}

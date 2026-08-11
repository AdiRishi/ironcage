import { createFileRoute } from "@tanstack/react-router";

import { PagePlaceholder } from "@/components/common/page-placeholder";

export const Route = createFileRoute("/portfolio/")({ component: PortfolioBook });

function PortfolioBook() {
  return (
    <PagePlaceholder
      title="Portfolio"
      description="Net worth, the whole-of-wealth toggle, and the current book."
      doc="docs/product/04-portfolio.md"
    />
  );
}

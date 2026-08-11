import { createFileRoute } from "@tanstack/react-router";

import { PagePlaceholder } from "@/components/common/page-placeholder";

export const Route = createFileRoute("/sleeves/$sleeveId/performance")({
  component: SleevePerformance,
});

function SleevePerformance() {
  return (
    <PagePlaceholder
      title="Performance"
      description="Equity, returns, drawdown, benchmarks, and the no-AI baseline this sleeve is measured against."
      doc="docs/product/02-sleeves.md"
    />
  );
}

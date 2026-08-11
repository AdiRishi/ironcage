import { createFileRoute } from "@tanstack/react-router";

import { PagePlaceholder } from "@/components/common/page-placeholder";

export const Route = createFileRoute("/sleeves/$sleeveId/")({ component: SleeveNow });

function SleeveNow() {
  return (
    <PagePlaceholder
      title="Now"
      description="What this sleeve reads in the market, the multipliers in force, and how far it sits from each of its cage limits."
      doc="docs/product/02-sleeves.md"
    />
  );
}

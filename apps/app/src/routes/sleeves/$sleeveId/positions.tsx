import { createFileRoute } from "@tanstack/react-router";

import { PagePlaceholder } from "@/components/common/page-placeholder";

export const Route = createFileRoute("/sleeves/$sleeveId/positions")({
  component: SleevePositions,
});

function SleevePositions() {
  return (
    <PagePlaceholder
      title="Positions"
      description="Open positions and working orders for this sleeve."
      doc="docs/product/02-sleeves.md"
    />
  );
}

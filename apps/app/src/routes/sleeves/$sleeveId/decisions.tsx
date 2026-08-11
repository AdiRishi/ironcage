import { createFileRoute } from "@tanstack/react-router";

import { PagePlaceholder } from "@/components/common/page-placeholder";

export const Route = createFileRoute("/sleeves/$sleeveId/decisions")({
  component: SleeveDecisions,
});

function SleeveDecisions() {
  return (
    <PagePlaceholder
      title="Decisions"
      description="The feed, filtered to this sleeve."
      doc="docs/product/03-activity.md"
    />
  );
}

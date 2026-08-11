import { createFileRoute } from "@tanstack/react-router";

import { PagePlaceholder } from "@/components/common/page-placeholder";

export const Route = createFileRoute("/sleeves/$sleeveId/capabilities")({
  component: SleeveCapabilities,
});

function SleeveCapabilities() {
  return (
    <PagePlaceholder
      title="Capabilities"
      description="Each AI capability wired into this sleeve: its latest output, how stale that output is, its scorecard, and any suspension."
      doc="docs/product/02-sleeves.md"
    />
  );
}

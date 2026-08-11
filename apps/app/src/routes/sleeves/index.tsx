import { createFileRoute } from "@tanstack/react-router";

import { PagePlaceholder } from "@/components/common/page-placeholder";

export const Route = createFileRoute("/sleeves/")({ component: SleeveRoster });

function SleeveRoster() {
  return (
    <PagePlaceholder
      title="Sleeves"
      description="The roster: every sleeve, its mode, its allocation against its cap, and what it is doing right now."
      doc="docs/product/02-sleeves.md"
    />
  );
}

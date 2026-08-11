import { createFileRoute } from "@tanstack/react-router";

import { PagePlaceholder } from "@/components/common/page-placeholder";

export const Route = createFileRoute("/sleeves/$sleeveId/trial")({ component: SleeveTrial });

function SleeveTrial() {
  return (
    <PagePlaceholder
      title="Trial"
      description="The trial report, when one is pending a promotion decision."
      doc="docs/product/06-reports.md"
    />
  );
}

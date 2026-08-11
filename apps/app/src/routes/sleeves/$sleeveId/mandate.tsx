import { createFileRoute } from "@tanstack/react-router";

import { PagePlaceholder } from "@/components/common/page-placeholder";

export const Route = createFileRoute("/sleeves/$sleeveId/mandate")({ component: SleeveMandate });

function SleeveMandate() {
  return (
    <PagePlaceholder
      title="Mandate"
      description="The mandate in force, and every earlier version with the diff that changed it."
      doc="docs/product/02-sleeves.md"
    />
  );
}

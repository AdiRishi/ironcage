import { createFileRoute } from "@tanstack/react-router";

import { PagePlaceholder } from "@/components/common/page-placeholder";

export const Route = createFileRoute("/decide/$ceremonyKind/$subjectId")({ component: Ceremony });

function Ceremony() {
  return (
    <PagePlaceholder
      title="Decision ceremony"
      description="The ceremony every consequential choice passes through: what is being decided, the evidence for it, and what it commits the system to."
      doc="docs/product/07-operations.md"
    />
  );
}

import { createFileRoute } from "@tanstack/react-router";

import { PagePlaceholder } from "@/components/common/page-placeholder";

export const Route = createFileRoute("/money/recurring")({ component: MoneyRecurring });

function MoneyRecurring() {
  return (
    <PagePlaceholder
      title="Recurring"
      description="Recurring charges, and anomalies against their usual shape."
      doc="docs/product/05-money.md"
    />
  );
}

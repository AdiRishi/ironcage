import { createFileRoute } from "@tanstack/react-router";

import { PagePlaceholder } from "@/components/common/page-placeholder";

export const Route = createFileRoute("/money/")({ component: MoneySpending });

function MoneySpending() {
  return (
    <PagePlaceholder
      title="Money"
      description="Complete-month spending, trends, balances, and the date the data runs through."
      doc="docs/product/05-money.md"
    />
  );
}

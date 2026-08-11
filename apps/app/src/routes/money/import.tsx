import { createFileRoute } from "@tanstack/react-router";

import { PagePlaceholder } from "@/components/common/page-placeholder";

export const Route = createFileRoute("/money/import")({ component: MoneyImport });

function MoneyImport() {
  return (
    <PagePlaceholder
      title="Import"
      description="A statement preview before it commits: source evidence, dedupe verdicts, balances, and coverage."
      doc="docs/product/05-money.md"
    />
  );
}

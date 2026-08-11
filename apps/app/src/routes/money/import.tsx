import { createFileRoute } from "@tanstack/react-router";

import { ImportFlow } from "@/features/money/components/import-flow";

export const Route = createFileRoute("/money/import")({ component: MoneyImport });

function MoneyImport() {
  return <ImportFlow />;
}

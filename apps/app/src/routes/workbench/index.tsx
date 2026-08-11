import { createFileRoute } from "@tanstack/react-router";

import { PagePlaceholder } from "@/components/common/page-placeholder";

export const Route = createFileRoute("/workbench/")({ component: WorkbenchRuns });

function WorkbenchRuns() {
  return (
    <PagePlaceholder
      title="Workbench"
      description="The trial counter and recent runs."
      doc="docs/product/08-workbench.md"
    />
  );
}

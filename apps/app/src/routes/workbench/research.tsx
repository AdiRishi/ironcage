import { createFileRoute } from "@tanstack/react-router";

import { PagePlaceholder } from "@/components/common/page-placeholder";

export const Route = createFileRoute("/workbench/research")({ component: WorkbenchResearch });

function WorkbenchResearch() {
  return (
    <PagePlaceholder
      title="Research"
      description="The research-agent conversation. A debugging-grade record: nothing said here can change the system."
      doc="docs/product/08-workbench.md"
    />
  );
}

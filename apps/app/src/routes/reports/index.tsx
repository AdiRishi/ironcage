import { createFileRoute } from "@tanstack/react-router";

import { PagePlaceholder } from "@/components/common/page-placeholder";

export const Route = createFileRoute("/reports/")({ component: ReportLibrary });

function ReportLibrary() {
  return (
    <PagePlaceholder
      title="Reports"
      description="The library: scheduled reviews, trial reports, and post-halt incident reports."
      doc="docs/product/06-reports.md"
    />
  );
}

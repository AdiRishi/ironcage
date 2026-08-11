import { createFileRoute } from "@tanstack/react-router";

import { PagePlaceholder } from "@/components/common/page-placeholder";

export const Route = createFileRoute("/reports/$reportId")({ component: ReportDetail });

function ReportDetail() {
  return (
    <PagePlaceholder
      title="Report"
      description="One rendered report."
      doc="docs/product/06-reports.md"
    />
  );
}

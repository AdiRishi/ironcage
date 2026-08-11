import { ReportId } from "@ironcage/domain";
import { createFileRoute } from "@tanstack/react-router";
import { Schema } from "effect";

import { ReportDetail } from "@/features/reports/components/report-detail";

const decodeReportId = Schema.decodeUnknownSync(ReportId);

export const Route = createFileRoute("/reports/$reportId")({
  // A path segment is a string until something checks it. Parsing here means the
  // component receives a ReportId and the router rejects anything that is not one.
  params: { parse: ({ reportId }) => ({ reportId: decodeReportId(reportId) }) },
  component: Report,
});

function Report() {
  const { reportId } = Route.useParams();

  return <ReportDetail reportId={reportId} />;
}

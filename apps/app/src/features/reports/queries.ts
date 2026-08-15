import { MonthlySpendingReport, ReportSummary } from "@ironcage/contracts/schema";
import type { ReportId } from "@ironcage/domain";
import { queryOptions } from "@tanstack/react-query";
import { Schema } from "effect";

import { keys } from "@/data/keys";
import { getReport, listReports } from "@/server/reports";

export const reportsQuery = queryOptions({
  queryKey: keys.reports(),
  queryFn: () => listReports(),
  select: Schema.decodeSync(Schema.Array(ReportSummary)),
});

export const reportQuery = (reportId: ReportId) =>
  queryOptions({
    queryKey: keys.report(reportId),
    queryFn: () => getReport({ data: { reportId } }),
    select: Schema.decodeSync(MonthlySpendingReport),
  });

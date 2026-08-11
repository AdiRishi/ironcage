import { MonthlySpendingReport, type ReportId } from "@ironcage/domain";
import { queryOptions } from "@tanstack/react-query";
import { Schema } from "effect";

import { readStaleTime, unwrap } from "@/data/core-call";
import { keys } from "@/data/keys";
import { getMonthlySpendingReport, listMonthlySpendingReports } from "@/server/money";

const RenderedReport = Schema.Struct({ report: MonthlySpendingReport, html: Schema.String });

export const reportsQuery = queryOptions({
  queryKey: keys.reports(),
  queryFn: () => listMonthlySpendingReports(),
  select: unwrap(Schema.Array(MonthlySpendingReport)),
  staleTime: readStaleTime,
});

export const reportQuery = (id: ReportId) =>
  queryOptions({
    queryKey: keys.report(id),
    queryFn: () => getMonthlySpendingReport({ data: { id } }),
    select: unwrap(RenderedReport),
    staleTime: readStaleTime,
  });

import { CalendarDate, Instant, ReportId, ReportType, RequestId } from "@ironcage/domain";
import { Schema } from "effect";
import { Rpc as RpcModule } from "effect/unstable/rpc";

import { Conflict, Internal, NotFound } from "./errors";
import { MonthAnalysis, SavingsSuggestion, SpendingAnomaly } from "./money";

export const ReportSummary = Schema.Struct({
  id: ReportId,
  type: ReportType,
  title: Schema.String,
  periodStart: CalendarDate,
  periodEnd: CalendarDate,
  generatedAt: Instant,
  openedAt: Schema.NullOr(Instant),
});
export type ReportSummary = typeof ReportSummary.Type;

export const MonthlySpendingReportContent = Schema.Struct({
  month: MonthAnalysis,
  anomalies: Schema.Array(SpendingAnomaly),
  suggestions: Schema.Array(SavingsSuggestion),
  dataThrough: CalendarDate,
});
export type MonthlySpendingReportContent = typeof MonthlySpendingReportContent.Type;

export const MonthlySpendingReport = Schema.Struct({
  ...ReportSummary.fields,
  type: Schema.Literal("monthly_spending"),
  ...MonthlySpendingReportContent.fields,
});
export type MonthlySpendingReport = typeof MonthlySpendingReport.Type;

export const listReportsRpc = RpcModule.make("listReports", {
  success: Schema.Array(ReportSummary),
  error: Internal,
});

export const GetReportInput = Schema.Struct({ reportId: ReportId });

export const getReportRpc = RpcModule.make("getReport", {
  payload: GetReportInput.fields,
  success: MonthlySpendingReport,
  error: Schema.Union([NotFound, Internal]),
});

export const MarkReportOpenedInput = Schema.Struct({
  requestId: RequestId,
  reportId: ReportId,
});

export const markReportOpenedRpc = RpcModule.make("markReportOpened", {
  payload: MarkReportOpenedInput.fields,
  success: ReportSummary,
  error: Schema.Union([NotFound, Conflict, Internal]),
});

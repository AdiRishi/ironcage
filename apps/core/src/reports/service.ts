import {
  MonthlySpendingReportContent,
  NotFound,
  ReportSummary,
  type MonthlySpendingReport,
} from "@ironcage/contracts/schema";
import { CalendarDate, FeedEventId, ReportId, type RequestId, type Sha256 } from "@ironcage/domain";
import { Effect, Schema } from "effect";

import { mintId } from "../ids";
import { analyzeMoney } from "../money/analysis/service";
import { insertFeedEvent } from "../money/feed/repository";
import { runIdempotentMutation } from "../persistence/app-requests";
import { decodeStored, persistenceToBoundary } from "../persistence/error";
import { decodeRows, Postgres, type SqlExecutor } from "../persistence/postgres";

const ReportRow = Schema.Struct({
  id: ReportId,
  type: Schema.Literal("monthly_spending"),
  title: Schema.String,
  periodStart: CalendarDate,
  periodEnd: CalendarDate,
  content: Schema.Unknown,
  generatedAt: Schema.DateTimeUtcFromDate,
  openedAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
});

const reportColumns = `id, report_type AS type, title,
  period_start AS "periodStart", period_end AS "periodEnd", content,
  generated_at AS "generatedAt", opened_at AS "openedAt"`;

const monthBounds = (month: string) => {
  const periodStart = Schema.decodeUnknownSync(CalendarDate)(`${month}-01`);
  const nextMonth = new Date(`${month}-01T00:00:00Z`);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  nextMonth.setUTCDate(0);
  const periodEnd = Schema.decodeUnknownSync(CalendarDate)(nextMonth.toISOString().slice(0, 10));
  return { periodStart, periodEnd };
};

const toSummary = (row: typeof ReportRow.Type): typeof ReportSummary.Type => ({
  id: row.id,
  type: row.type,
  title: row.title,
  periodStart: row.periodStart,
  periodEnd: row.periodEnd,
  generatedAt: row.generatedAt,
  openedAt: row.openedAt,
});

const decodeReport = (row: typeof ReportRow.Type) =>
  decodeStored(MonthlySpendingReportContent, row.content, "monthly spending report").pipe(
    Effect.map((content) => ({ ...toSummary(row), ...content }) satisfies MonthlySpendingReport),
  );

export const generateMonthlySpendingReports = (sql: SqlExecutor) =>
  Effect.gen(function* () {
    const analysis = yield* analyzeMoney(sql);
    if (analysis.dataThrough === null) return 0;

    let generated = 0;
    for (const month of analysis.months) {
      if (!month.complete) continue;
      const { periodStart, periodEnd } = monthBounds(month.month);
      const reportId = yield* mintId(ReportId);
      const content = {
        month,
        anomalies: analysis.anomalies.filter((anomaly) => anomaly.month === month.month),
        suggestions: analysis.suggestions,
        dataThrough: analysis.dataThrough,
      } satisfies typeof MonthlySpendingReportContent.Type;
      const encoded = Schema.encodeSync(MonthlySpendingReportContent)(content);
      const inserted = yield* sql.query(
        "generate monthly spending report",
        `INSERT INTO reports
           (id, report_type, title, period_start, period_end, content, generated_at)
         VALUES ($1, 'monthly_spending', $2, $3, $4, $5::jsonb, now())
         ON CONFLICT (report_type, period_start, period_end) DO NOTHING
         RETURNING id`,
        [
          reportId,
          `${month.month} spending report`,
          periodStart,
          periodEnd,
          JSON.stringify(encoded),
        ],
      );
      if (inserted.length === 0) continue;

      yield* insertFeedEvent(sql, {
        id: yield* mintId(FeedEventId),
        origin: "reports",
        category: "system",
        eventType: "report_generated",
        severity: "info",
        summary: `${month.month} spending report generated`,
        payload: { reportId, reportType: "monthly_spending", month: month.month },
        links: { report: reportId },
      });
      generated += 1;
    }

    return generated;
  });

export const listReports = () =>
  Effect.gen(function* () {
    const postgres = yield* Postgres;
    const rows = yield* postgres.readTransaction((sql) =>
      sql.query(
        "list reports",
        `SELECT ${reportColumns} FROM reports ORDER BY generated_at DESC, id DESC`,
      ),
    );
    return (yield* decodeRows("decode reports", ReportRow, rows)).map(toSummary);
  }).pipe(persistenceToBoundary);

export const getReport = (reportId: ReportId) =>
  Effect.gen(function* () {
    const postgres = yield* Postgres;
    const rows = yield* postgres.readTransaction((sql) =>
      sql.query("get report", `SELECT ${reportColumns} FROM reports WHERE id = $1`, [reportId]),
    );
    const row = (yield* decodeRows("decode report", ReportRow, rows))[0];
    if (row === undefined) {
      return yield* Effect.fail(new NotFound({ entity: "report", id: reportId }));
    }
    return yield* decodeReport(row);
  }).pipe(persistenceToBoundary);

export const markReportOpened = (input: {
  readonly requestId: RequestId;
  readonly payloadHash: Sha256;
  readonly reportId: ReportId;
}) =>
  runIdempotentMutation(
    {
      requestId: input.requestId,
      operation: "markReportOpened",
      payloadHash: input.payloadHash,
      response: ReportSummary,
    },
    (sql) =>
      Effect.gen(function* () {
        const rows = yield* sql.query(
          "mark report opened",
          `UPDATE reports SET opened_at = COALESCE(opened_at, now()) WHERE id = $1
           RETURNING ${reportColumns}`,
          [input.reportId],
        );
        const row = (yield* decodeRows("decode opened report", ReportRow, rows))[0];
        if (row === undefined) {
          return yield* Effect.fail(new NotFound({ entity: "report", id: input.reportId }));
        }
        return toSummary(row);
      }),
  );

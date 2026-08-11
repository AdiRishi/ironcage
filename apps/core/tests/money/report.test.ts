import {
  BankTransactionId,
  CalendarDate,
  CalendarMonth,
  CategoryId,
  Money,
  ReportId,
  type MonthlySpendingReport,
} from "@ironcage/domain";
import { BigDecimal, DateTime, Schema } from "effect";
import { describe, expect, test } from "vitest";

import { renderMonthlySpendingReport } from "../../src/money/report";

const date = Schema.decodeUnknownSync(CalendarDate);
const month = Schema.decodeUnknownSync(CalendarMonth);
const money = Schema.decodeUnknownSync(Money);
const groceriesId = Schema.decodeUnknownSync(CategoryId)("018f0000-0000-7000-8000-000000003001");
const transactionId = Schema.decodeUnknownSync(BankTransactionId)(
  "018f0000-0000-7000-8000-000000003002",
);

const report: MonthlySpendingReport = {
  id: Schema.decodeUnknownSync(ReportId)("018f0000-0000-7000-8000-000000003000"),
  month: month("2026-07"),
  generatedAt: DateTime.makeUnsafe("2026-08-05T09:30:00Z"),
  readAt: null,
  dataThrough: date("2026-07-31"),
  analysis: {
    month: month("2026-07"),
    coverage: { _tag: "Complete" },
    income: money("9500.00"),
    netSpend: money("1954.80"),
    savingsRate: BigDecimal.fromStringUnsafe("0.7942"),
    categories: [
      {
        categoryId: groceriesId,
        name: "Groceries",
        netSpend: money("1954.80"),
        trailingThreeMonthAverage: money("1200.00"),
        transactionIds: [transactionId],
      },
    ],
  },
  recurringCharges: [],
  anomalies: [
    {
      _tag: "CategorySpike",
      categoryId: groceriesId,
      month: month("2026-07"),
      netSpend: money("1954.80"),
      trailingAverage: money("1200.00"),
    },
  ],
  suggestions: [],
  supportingTransactionIds: [transactionId],
  bodyKey: "reports/018f0000-0000-7000-8000-000000003000.html",
};

describe("the monthly spending report", () => {
  /**
   * The canonical decimal string a key compares drops a trailing zero and never
   * groups thousands. A report that reads `$1954.8` is what that string looks
   * like when it escapes onto a page an operator reads.
   */
  test("writes every figure at the minor unit, grouped", () => {
    const html = renderMonthlySpendingReport(report);

    expect(html).toContain("$1,954.80");
    expect(html).toContain("$9,500.00");
    expect(html).toContain("79.4%");
    expect(html).not.toContain("$1954.8");
  });

  test("names the month and the category rather than printing their keys", () => {
    const html = renderMonthlySpendingReport(report);

    expect(html).toContain("July 2026");
    expect(html).toContain("Groceries rose to");
    expect(html).not.toContain(groceriesId);
  });

  test("escapes source text so a narrative cannot become markup", () => {
    const html = renderMonthlySpendingReport({
      ...report,
      analysis: {
        ...report.analysis,
        categories: [{ ...report.analysis.categories[0]!, name: '<script>x</script>&"' }],
      },
    });

    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;&amp;&quot;");
    expect(html).not.toContain("<script>x</script>");
  });
});

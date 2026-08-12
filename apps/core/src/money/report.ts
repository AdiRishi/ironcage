import {
  formatAud,
  formatFullDay,
  formatMoment,
  formatMonth,
  formatRate,
  type MonthlySpendingReport,
} from "@ironcage/domain";

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const transactionLinks = (ids: readonly string[]) =>
  ids
    .map(
      (id) =>
        `<a href="/money/transactions/${encodeURIComponent(id)}" class="record">${escapeHtml(id.slice(-8))}</a>`,
    )
    .join(" ");

export const renderMonthlySpendingReport = (report: MonthlySpendingReport) => {
  // A spike names a category by ID. The month's own rows are where that ID has
  // a name, so a reader sees "Groceries" rather than a UUID.
  const categoryNames = new Map(
    report.analysis.categories.map((category) => [category.categoryId, category.name] as const),
  );
  const categoryRows = report.analysis.categories
    .map(
      (category) => `<tr>
        <td>${escapeHtml(category.name)}</td>
        <td class="number">${formatAud(category.netSpend)}</td>
        <td class="number">${category.trailingThreeMonthAverage === null ? "—" : formatAud(category.trailingThreeMonthAverage)}</td>
        <td>${transactionLinks(category.transactionIds)}</td>
      </tr>`,
    )
    .join("");
  const recurring = report.recurringCharges
    .map(
      (charge) => `<li>
        <strong>${escapeHtml(charge.payee)}</strong> — ${formatAud(charge.latestAmount)} every ~${charge.cadenceDays} days,
        about ${formatAud(charge.estimatedAnnualSpend)} a year.
        ${charge.priceChange === null ? "" : `Changed from ${formatAud(charge.priceChange.previousAmount)} to ${formatAud(charge.priceChange.currentAmount)}.`}
        <span>${transactionLinks(charge.transactionIds)}</span>
      </li>`,
    )
    .join("");
  const anomalies = report.anomalies
    .map((anomaly) => {
      switch (anomaly._tag) {
        case "LargeExpense":
          return `<li>Large expense of ${formatAud(anomaly.amount)}. ${transactionLinks([anomaly.transactionId])}</li>`;
        case "NewPayee":
          return `<li>First high-value payment to ${escapeHtml(anomaly.payee)}: ${formatAud(anomaly.amount)}. ${transactionLinks([anomaly.transactionId])}</li>`;
        case "CategorySpike":
          return `<li>${escapeHtml(categoryNames.get(anomaly.categoryId) ?? anomaly.categoryId)} rose to ${formatAud(anomaly.netSpend)}, from a ${formatAud(anomaly.trailingAverage)} trailing average.</li>`;
      }
    })
    .join("");
  const suggestions = report.suggestions
    .map(
      (suggestion) => `<li>
        <strong>${escapeHtml(suggestion.title)}</strong> — ${escapeHtml(suggestion.reasoning)}
        Potential annual impact: ${formatAud(suggestion.estimatedAnnualImpact)}.
        ${transactionLinks(suggestion.transactionIds)}
      </li>`,
    )
    .join("");
  const savingsRate =
    report.analysis.savingsRate === null ? "—" : formatRate(report.analysis.savingsRate);
  const monthName = formatMonth(report.month);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Spending report — ${monthName}</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; color: #17211b; background: #f3f1e9; }
    body { margin: 0; }
    main { max-width: 880px; margin: 0 auto; padding: 64px 32px 96px; }
    header { border-bottom: 1px solid #b9b8ae; padding-bottom: 28px; }
    .eyebrow { font: 600 12px ui-monospace, monospace; letter-spacing: .12em; text-transform: uppercase; color: #526159; }
    h1 { margin: 10px 0 8px; font-size: clamp(36px, 7vw, 68px); letter-spacing: -.045em; }
    h2 { margin-top: 48px; font-size: 23px; }
    .summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin: 28px 0; }
    .metric { padding: 18px; border: 1px solid #c9c7bc; border-radius: 12px; background: #faf9f4; }
    .metric span { display: block; color: #607067; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
    .metric strong { display: block; margin-top: 8px; font-size: 26px; }
    table { width: 100%; border-collapse: collapse; background: #faf9f4; }
    th, td { padding: 13px 14px; border-bottom: 1px solid #dedcd2; text-align: left; vertical-align: top; }
    th { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: #526159; }
    .number { text-align: right; font-variant-numeric: tabular-nums; }
    li { margin: 12px 0; line-height: 1.55; }
    .record { display: inline-block; margin: 2px; padding: 2px 6px; border-radius: 5px; background: #dfe6df; color: #24412e; font: 12px ui-monospace, monospace; }
    footer { margin-top: 56px; color: #607067; font-size: 13px; }
    @media (max-width: 620px) { .summary { grid-template-columns: 1fr; } main { padding: 36px 18px 64px; } }
  </style>
</head>
<body>
<main>
  <header>
    <div class="eyebrow">Ironcage · AUD · recorded data through ${formatFullDay(report.dataThrough)}</div>
    <h1>${monthName}</h1>
    <p>Your complete-month spending record, with every conclusion linked back to its transactions.</p>
  </header>
  <section class="summary">
    <div class="metric"><span>Income</span><strong>${report.analysis.income === null ? "—" : formatAud(report.analysis.income)}</strong></div>
    <div class="metric"><span>Net spend</span><strong>${report.analysis.netSpend === null ? "—" : formatAud(report.analysis.netSpend)}</strong></div>
    <div class="metric"><span>Savings rate</span><strong>${savingsRate}</strong></div>
  </section>
  <h2>Spending by category</h2>
  <table><thead><tr><th>Category</th><th class="number">Net spend</th><th class="number">Trailing average</th><th>Records</th></tr></thead><tbody>${categoryRows}</tbody></table>
  <h2>Recurring charges</h2><ul>${recurring || "<li>None met the recurring-charge evidence threshold.</li>"}</ul>
  <h2>Anomalies</h2><ul>${anomalies || "<li>No configured anomaly rule fired.</li>"}</ul>
  <h2>Suggestions</h2><ul>${suggestions || "<li>No grounded savings suggestion is available for this month.</li>"}</ul>
  <footer>Generated ${formatMoment(report.generatedAt)}. This report recommends; it never acts.</footer>
</main>
</body>
</html>`;
};

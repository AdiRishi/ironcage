import type { ContributorsInput, PeriodSelection } from "@repo/contracts/finance";

import { groupLabels, measureLabels } from "./labels";

function periodSummary(period: PeriodSelection) {
  switch (period.kind) {
    case "fixed":
      return `${period.start} to ${period.endExclusive}, end excluded`;
    case "rolling":
      return `Last ${period.days} days`;
    case "calendar":
      return `${period.count} ${period.unit}${period.count === 1 ? "" : "s"}, offset ${period.offset}, ${period.alignment}`;
  }
}
export function definitionSummary({ query, groupBy }: typeof ContributorsInput.Type) {
  const comparison =
    query.comparison.kind === "fixed"
      ? `${query.comparison.start} to ${query.comparison.endExclusive}, end excluded`
      : query.comparison.kind === "previous"
        ? "previous period"
        : "previous year";
  const filters = Object.entries(query.filters)
    .filter(([, ids]) => ids.length)
    .map(([name, ids]) => `${ids.length} ${name}`)
    .join(", ");
  return `${measureLabels[query.measure]} · ${periodSummary(query.period)} against ${comparison} · ${query.basis} · ${query.currency} · ${query.accounts.length ? `${query.accounts.length} account${query.accounts.length === 1 ? "" : "s"}` : "All accounts"} · ${groupLabels[groupBy]} · ${query.normalization === "total" ? "Total" : "Daily average"}${filters ? ` · ${filters}` : ""}`;
}

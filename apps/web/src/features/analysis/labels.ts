import type { Measure, GroupBy, MetricValue } from "@repo/contracts/finance";
import { formatMoney } from "@repo/finance";
export const measureLabels = {
  grossCosts: "Gross costs",
  netPersonalCosts: "Net personal costs",
  income: "Income",
  surplus: "Surplus after costs",
  surplusRate: "Surplus rate",
  cashBalanceChange: "Cash balance change",
  netPrincipalReduction: "Net principal reduction",
  purchaseCount: "Purchase count",
} satisfies Record<Measure, string>;
export const groupLabels = {
  category: "Category",
  merchant: "Merchant",
  account: "Account",
  tag: "Tag",
  personalEvent: "Personal event",
} satisfies Record<GroupBy, string>;
export function formatMetric(value: MetricValue): string {
  switch (value.kind) {
    case "money":
      return formatMoney(value.amount);
    case "count":
      return String(value.count);
    case "percent":
      return `${value.value}%`;
    case "dailyAverage":
      return `${value.amount.value} ${value.amount.currency}/day`;
    case "unavailable":
      return "Unavailable";
  }
}
export function chartValue(value: MetricValue): number {
  switch (value.kind) {
    case "money":
      return Number(value.amount.minor);
    case "count":
      return value.count;
    case "percent":
      return Number(value.value);
    case "dailyAverage":
      return Number(value.amount.value);
    case "unavailable":
      return 0;
  }
}

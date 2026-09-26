import type { CountUnit, FigureValue } from "@repo/contracts/analyst";

import { formatCurrency, formatPercent } from "./money.ts";

const units = {
  purchase: ["purchase", "purchases"],
  transaction: ["transaction", "transactions"],
  question: ["question", "questions"],
} satisfies Record<typeof CountUnit.Type, readonly [string, string]>;

// A figure as an answer shows it, which is also the value the model reads beside its
// token: "$720.00", "+$310.00" for a change, "3 purchases", "76%", or "+76%".
export function figureText(value: FigureValue) {
  switch (value.kind) {
    case "money":
      return value.signed && value.amount.minor > 0n
        ? `+${formatCurrency(value.amount)}`
        : formatCurrency(value.amount);
    case "count":
      return `${value.count} ${units[value.unit][value.count === 1 ? 0 : 1]}`;
    case "percent":
      return formatPercent(value.percent, { signed: value.signed });
  }
}

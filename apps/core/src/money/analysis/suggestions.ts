import type { SavingsSuggestion } from "@ironcage/contracts/schema";
import { addDays, monthOf, type CalendarDate } from "@ironcage/domain";
import { BigDecimal } from "effect";

import { decimal, toAud } from "./amounts";
import { analysisConfig, type RecurringGroup } from "./model";

export const computeSuggestions = (
  recurring: readonly RecurringGroup[],
  completeMonths: ReadonlySet<string>,
  dataThrough: CalendarDate,
): { readonly suggestions: readonly SavingsSuggestion[]; readonly unavailable: string | null } => {
  const windowStart = addDays(dataThrough, -analysisConfig.recurringWindowDays);
  const earliestComplete = [...completeMonths].sort()[0];
  if (earliestComplete === undefined) {
    return { suggestions: [], unavailable: "no complete Money month yet" };
  }

  const from = earliestComplete > monthOf(windowStart) ? earliestComplete : monthOf(windowStart);
  const interior: string[] = [];
  const cursor = new Date(`${from}-01T00:00:00Z`);
  cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  while (cursor.toISOString().slice(0, 7) < monthOf(dataThrough)) {
    interior.push(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  const gap = interior.find((month) => !completeMonths.has(month));
  if (gap !== undefined) {
    return {
      suggestions: [],
      unavailable: `required-account coverage has a gap in ${gap}; suggestions need a complete supporting window`,
    };
  }

  const floor = decimal(analysisConfig.steadyChargeAnnualFloor);
  const suggestions: SavingsSuggestion[] = [];

  for (const group of recurring) {
    if (
      group.priceChange !== null &&
      BigDecimal.isGreaterThan(group.priceChange.to, group.priceChange.from)
    ) {
      const rise = BigDecimal.subtract(group.priceChange.to, group.priceChange.from);
      suggestions.push({
        kind: "price_rise",
        payee: group.payee,
        annualAmount: toAud(
          BigDecimal.divideUnsafe(
            BigDecimal.multiply(rise, decimal("365")),
            decimal(String(group.cadenceDays)),
          ),
        ),
        detail: `${group.payee} rose from ${BigDecimal.format(group.priceChange.from)} to ${BigDecimal.format(group.priceChange.to)} on ${group.priceChange.on}`,
        transactionIds: group.transactionIds,
        dataThrough,
      });
      continue;
    }

    if (BigDecimal.isGreaterThanOrEqualTo(group.annualizedAmount, floor)) {
      suggestions.push({
        kind: "steady_charge",
        payee: group.payee,
        annualAmount: group.annualizedAmount,
        detail: `${group.payee} recurs every ~${group.cadenceDays} days at ${BigDecimal.format(group.medianAmount)}`,
        transactionIds: group.transactionIds,
        dataThrough,
      });
    }
  }

  return { suggestions, unavailable: null };
};

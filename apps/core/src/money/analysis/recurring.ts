import { addDays, daysBetween, type CalendarDate } from "@ironcage/domain";
import { BigDecimal } from "effect";

import { decimal, medianAmount, medianNumber, toAud } from "./amounts";
import { analysisConfig, type RecurringGroup, type SplitLine } from "./model";

export const computeRecurring = (
  lines: readonly SplitLine[],
  dataThrough: CalendarDate,
): readonly RecurringGroup[] => {
  const windowStart = addDays(dataThrough, -analysisConfig.recurringWindowDays);
  const groups = new Map<string, SplitLine[]>();

  for (const line of lines) {
    if (line.kind !== "expense" || !BigDecimal.isNegative(line.amount)) continue;
    if (line.postedDate < windowStart || line.postedDate > dataThrough) continue;
    const key = line.payee.toLowerCase();
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [line]);
    else group.push(line);
  }

  const tolerance = decimal(analysisConfig.recurringAmountTolerance);
  const results: RecurringGroup[] = [];

  for (const occurrences of groups.values()) {
    if (occurrences.length < analysisConfig.recurringMinOccurrences) continue;

    const amounts = occurrences.map((line) => BigDecimal.abs(line.amount));
    const median = medianAmount(amounts);
    const allowed = BigDecimal.multiply(median, tolerance);
    if (
      !amounts.every((amount) =>
        BigDecimal.isLessThanOrEqualTo(
          BigDecimal.abs(BigDecimal.subtract(amount, median)),
          allowed,
        ),
      )
    ) {
      continue;
    }

    const gaps = occurrences
      .slice(1)
      .map((line, index) => daysBetween(occurrences[index]!.postedDate, line.postedDate));
    const medianGap = medianNumber(gaps);
    const bucket = analysisConfig.cadenceBuckets.find(
      (candidate) => Math.abs(medianGap - candidate.days) <= candidate.tolerance,
    );
    if (bucket === undefined) continue;

    const meanGap = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
    const deviation = Math.sqrt(
      gaps.reduce((sum, gap) => sum + (gap - meanGap) ** 2, 0) / gaps.length,
    );
    if (deviation > Number(analysisConfig.recurringGapDeviation) * medianGap) continue;

    const last = occurrences[occurrences.length - 1]!;
    const previous = occurrences[occurrences.length - 2]!;
    const lastAmount = BigDecimal.abs(last.amount);
    const previousAmount = BigDecimal.abs(previous.amount);
    const difference = BigDecimal.abs(BigDecimal.subtract(lastAmount, previousAmount));
    const changed =
      BigDecimal.isGreaterThan(
        difference,
        BigDecimal.multiply(previousAmount, decimal(analysisConfig.priceChangeMinRatio)),
      ) &&
      BigDecimal.isGreaterThanOrEqualTo(difference, decimal(analysisConfig.priceChangeMinAmount));

    results.push({
      payee: last.payee,
      cadenceDays: bucket.days,
      occurrences: occurrences.length,
      medianAmount: toAud(median),
      annualizedAmount: toAud(
        BigDecimal.divideUnsafe(
          BigDecimal.multiply(median, decimal("365")),
          decimal(String(bucket.days)),
        ),
      ),
      lastSeen: last.postedDate,
      priceChange: changed
        ? { from: toAud(previousAmount), to: toAud(lastAmount), on: last.postedDate }
        : null,
      transactionIds: [...new Set(occurrences.map((line) => line.transactionId))],
    });
  }

  return results.sort((a, b) => a.payee.localeCompare(b.payee));
};

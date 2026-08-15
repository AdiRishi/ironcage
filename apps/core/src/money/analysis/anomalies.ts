import type { MonthAnalysis, SpendingAnomaly } from "@ironcage/contracts/schema";
import {
  addDays,
  monthOf,
  type BankAccountId,
  type BankTransactionId,
  type CalendarDate,
} from "@ironcage/domain";
import { BigDecimal } from "effect";

import { decimal, medianAmount, toAud, zero } from "./amounts";
import { analysisConfig, type SplitLine } from "./model";
import { previousMonths } from "./months";

interface ExpenseTransaction {
  readonly transactionId: BankTransactionId;
  readonly accountId: BankAccountId;
  readonly postedDate: CalendarDate;
  readonly payee: string;
  readonly magnitude: BigDecimal.BigDecimal;
}

const expenseTransactions = (lines: readonly SplitLine[]): readonly ExpenseTransaction[] => {
  const byTransaction = new Map<
    BankTransactionId,
    ExpenseTransaction & { sum: BigDecimal.BigDecimal }
  >();
  for (const line of lines) {
    if (line.kind !== "expense") continue;
    const existing = byTransaction.get(line.transactionId);
    if (existing === undefined) {
      byTransaction.set(line.transactionId, {
        transactionId: line.transactionId,
        accountId: line.accountId,
        postedDate: line.postedDate,
        payee: line.payee,
        magnitude: zero,
        sum: line.amount,
      });
    } else {
      existing.sum = BigDecimal.sum(existing.sum, line.amount);
    }
  }
  return [...byTransaction.values()]
    .filter((transaction) => BigDecimal.isNegative(transaction.sum))
    .map((transaction) => ({ ...transaction, magnitude: BigDecimal.abs(transaction.sum) }))
    .sort((a, b) => (a.postedDate < b.postedDate ? -1 : a.postedDate > b.postedDate ? 1 : 0));
};

export const computeAnomalies = (
  lines: readonly SplitLine[],
  months: readonly MonthAnalysis[],
  completeMonths: ReadonlySet<string>,
): readonly SpendingAnomaly[] => {
  const anomalies = new Map<string, SpendingAnomaly>();
  const record = (anomaly: SpendingAnomaly) => {
    const key = `${anomaly.rule}|${anomaly.subject.toLowerCase()}|${anomaly.month}`;
    const existing = anomalies.get(key);
    if (
      existing === undefined ||
      (anomaly.amount !== null &&
        (existing.amount === null || BigDecimal.isGreaterThan(anomaly.amount, existing.amount)))
    ) {
      anomalies.set(key, anomaly);
    }
  };

  const transactions = expenseTransactions(lines);
  const floor = decimal(analysisConfig.largeExpenseFloor);
  const multiple = decimal(analysisConfig.largeExpenseMultiple);
  const lastSeenByPayee = new Map<string, CalendarDate>();

  for (const [index, transaction] of transactions.entries()) {
    const windowStart = addDays(transaction.postedDate, -analysisConfig.largeExpenseMedianDays);
    const priors: BigDecimal.BigDecimal[] = [];
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const prior = transactions[cursor]!;
      if (prior.postedDate < windowStart) break;
      if (prior.accountId === transaction.accountId) priors.push(prior.magnitude);
    }
    const baseline = priors.length === 0 ? zero : medianAmount(priors);
    const threshold = BigDecimal.max(floor, BigDecimal.multiply(baseline, multiple));
    if (BigDecimal.isGreaterThan(transaction.magnitude, threshold)) {
      record({
        rule: "large_expense",
        month: monthOf(transaction.postedDate),
        subject: transaction.payee,
        amount: toAud(transaction.magnitude),
        detail: `${BigDecimal.format(transaction.magnitude)} exceeds the ${BigDecimal.format(threshold)} threshold`,
      });
    }

    const payeeKey = transaction.payee.toLowerCase();
    const lastSeen = lastSeenByPayee.get(payeeKey);
    const lookbackStart = addDays(transaction.postedDate, -analysisConfig.newPayeeLookbackDays);
    if (
      (lastSeen === undefined || lastSeen < lookbackStart) &&
      BigDecimal.isGreaterThanOrEqualTo(
        transaction.magnitude,
        decimal(analysisConfig.newPayeeMinAmount),
      )
    ) {
      record({
        rule: "new_payee",
        month: monthOf(transaction.postedDate),
        subject: transaction.payee,
        amount: toAud(transaction.magnitude),
        detail: `first appearance of ${transaction.payee} within ${analysisConfig.newPayeeLookbackDays} days`,
      });
    }
    lastSeenByPayee.set(payeeKey, transaction.postedDate);
  }

  const spendByMonthCategory = new Map<string, BigDecimal.BigDecimal>();
  for (const month of months) {
    for (const category of month.categories) {
      if (category.kind === "expense") {
        spendByMonthCategory.set(`${month.month}|${category.name}`, category.amount);
      }
    }
  }
  for (const month of months) {
    if (!month.complete) continue;
    const window = previousMonths(month.month, 3);
    if (!window.every((previous) => completeMonths.has(previous))) continue;

    for (const category of month.categories) {
      if (category.kind !== "expense") continue;
      const average = BigDecimal.divideUnsafe(
        window.reduce(
          (sum, previous) =>
            BigDecimal.sum(sum, spendByMonthCategory.get(`${previous}|${category.name}`) ?? zero),
          zero,
        ),
        decimal("3"),
      );
      const spiking =
        BigDecimal.isGreaterThan(
          category.amount,
          BigDecimal.multiply(average, decimal(analysisConfig.spikeMultiple)),
        ) &&
        BigDecimal.isGreaterThanOrEqualTo(
          BigDecimal.subtract(category.amount, average),
          decimal(analysisConfig.spikeMinExcess),
        );
      if (spiking) {
        record({
          rule: "category_spike",
          month: month.month,
          subject: category.name,
          amount: category.amount,
          detail: `${BigDecimal.format(category.amount)} against a ${BigDecimal.format(BigDecimal.round(average, { scale: 2, mode: "half-even" }))} trailing average`,
        });
      }
    }
  }

  return [...anomalies.values()].sort((a, b) =>
    a.month === b.month ? a.subject.localeCompare(b.subject) : b.month.localeCompare(a.month),
  );
};

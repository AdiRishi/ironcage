import {
  CalendarDate,
  CalendarMonth,
  Money,
  MoneyAnalysis,
  MonthlyMoneyAnalysis,
  type BankAccount,
  type BankTransactionId,
  type CategoryId,
  type CategoryKind,
  type RecurringCharge,
  type SavingsSuggestion,
  type SpendingAnomaly,
} from "@ironcage/domain";
import { BigDecimal, DateTime, Schema } from "effect";

import {
  calendarMonthForDate,
  calendarMonthsBetween,
  calendarMonthWindow,
  coverageGaps,
  shiftCalendarDate,
  shiftCalendarMonth,
  type CoverageSegment,
} from "./coverage";

export interface AnalysisTransaction {
  readonly id: BankTransactionId;
  readonly accountId: BankAccount["id"];
  readonly postedDate: CalendarDate;
  readonly amount: Money;
  readonly payee: string;
  readonly narrative: string;
  readonly ownedTransfer: boolean;
  readonly splits: readonly {
    readonly categoryId: CategoryId;
    readonly categoryName: string;
    readonly categoryKind: CategoryKind;
    readonly amount: Money;
  }[];
}

export interface MoneyAnalysisRecord {
  readonly accounts: readonly BankAccount[];
  readonly coverage: readonly CoverageSegment[];
  readonly transactions: readonly AnalysisTransaction[];
}

const moneyFrom = (value: BigDecimal.BigDecimal) =>
  Schema.decodeUnknownSync(Money)(
    BigDecimal.format(
      BigDecimal.normalize(BigDecimal.round(value, { scale: 8, mode: "half-even" })),
    ),
  );
const zero = Schema.decodeUnknownSync(Money)("0");
const two = BigDecimal.fromBigInt(2n);
const three = BigDecimal.fromBigInt(3n);
const four = BigDecimal.fromBigInt(4n);
const fivePercent = BigDecimal.fromStringUnsafe("0.05");
const onePercent = BigDecimal.fromStringUnsafe("0.01");
const dollar = BigDecimal.fromBigInt(1n);
const twoHundred = BigDecimal.fromBigInt(200n);
const fiveHundred = BigDecimal.fromBigInt(500n);
const oneHundredFifty = BigDecimal.fromBigInt(150n);

const sum = (values: Iterable<BigDecimal.BigDecimal>) => moneyFrom(BigDecimal.sumAll(values));

const median = (values: readonly Money[]): Money => {
  const sorted = [...values].sort(BigDecimal.Order);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 1
    ? sorted[middle]!
    : moneyFrom(BigDecimal.divideUnsafe(BigDecimal.sum(sorted[middle - 1]!, sorted[middle]!), two));
};

const dayGap = (earlier: CalendarDate, later: CalendarDate) =>
  (DateTime.toEpochMillis(DateTime.makeUnsafe(`${later}T00:00:00Z`)) -
    DateTime.toEpochMillis(DateTime.makeUnsafe(`${earlier}T00:00:00Z`))) /
  86_400_000;

const cadenceFor = (medianGap: number) =>
  [
    { days: 7, tolerance: 2 },
    { days: 14, tolerance: 3 },
    { days: 30, tolerance: 4 },
    { days: 91, tolerance: 7 },
    { days: 365, tolerance: 10 },
  ].find(({ days, tolerance }) => Math.abs(medianGap - days) <= tolerance)?.days;

const expenseByTransaction = (transaction: AnalysisTransaction) =>
  transaction.ownedTransfer
    ? zero
    : sum(
        transaction.splits
          .filter((split) => split.categoryKind === "expense")
          .map((split) => split.amount),
      );

const recurringCharges = (
  transactions: readonly AnalysisTransaction[],
  dataThrough: CalendarDate,
) => {
  const start = shiftCalendarDate(dataThrough, -399);
  const byPayee = new Map<string, AnalysisTransaction[]>();

  for (const transaction of transactions) {
    if (
      transaction.ownedTransfer ||
      transaction.postedDate < start ||
      transaction.postedDate > dataThrough
    ) {
      continue;
    }
    const expense = expenseByTransaction(transaction);
    if (BigDecimal.sign(expense) >= 0) continue;

    byPayee.set(transaction.payee, [...(byPayee.get(transaction.payee) ?? []), transaction]);
  }

  const recurring: RecurringCharge[] = [];
  for (const [payee, group] of byPayee) {
    if (group.length < 3) continue;

    const ordered = [...group].sort((left, right) =>
      left.postedDate.localeCompare(right.postedDate),
    );
    const amounts = ordered.map((transaction) =>
      moneyFrom(BigDecimal.abs(expenseByTransaction(transaction))),
    );
    const typicalAmount = median(amounts);
    const tolerance = BigDecimal.multiply(typicalAmount, fivePercent);
    if (
      amounts.some((amount) =>
        BigDecimal.isGreaterThan(
          BigDecimal.abs(BigDecimal.subtract(amount, typicalAmount)),
          tolerance,
        ),
      )
    ) {
      continue;
    }

    const gaps = ordered
      .slice(1)
      .map((transaction, index) => dayGap(ordered[index]!.postedDate, transaction.postedDate));
    const sortedGaps = [...gaps].sort((left, right) => left - right);
    const middle = Math.floor(sortedGaps.length / 2);
    const medianGap =
      sortedGaps.length % 2 === 1
        ? sortedGaps[middle]!
        : (sortedGaps[middle - 1]! + sortedGaps[middle]!) / 2;
    const cadenceDays = cadenceFor(medianGap);
    if (cadenceDays === undefined) continue;

    const averageGap = gaps.reduce((total, gap) => total + gap, 0) / gaps.length;
    const standardDeviation = Math.sqrt(
      gaps.reduce((total, gap) => total + (gap - averageGap) ** 2, 0) / gaps.length,
    );
    if (standardDeviation > medianGap * 0.2) continue;

    const latestAmount = amounts.at(-1)!;
    const previousAmount = amounts.at(-2)!;
    const absoluteChange = BigDecimal.abs(BigDecimal.subtract(latestAmount, previousAmount));
    const relativeChange = BigDecimal.divideUnsafe(absoluteChange, previousAmount);
    const priceChange =
      BigDecimal.isGreaterThan(relativeChange, onePercent) &&
      BigDecimal.isGreaterThanOrEqualTo(absoluteChange, dollar)
        ? { previousAmount, currentAmount: latestAmount }
        : null;
    const annualFrequency = BigDecimal.divideUnsafe(
      BigDecimal.fromBigInt(365n),
      BigDecimal.fromBigInt(BigInt(cadenceDays)),
    );
    recurring.push({
      payee,
      cadenceDays,
      typicalAmount,
      latestAmount,
      estimatedAnnualSpend: moneyFrom(BigDecimal.multiply(typicalAmount, annualFrequency)),
      priceChange,
      transactionIds: ordered.map((transaction) => transaction.id),
    });
  }

  return recurring.sort((left, right) => left.payee.localeCompare(right.payee));
};

const detectTransactionAnomalies = (
  record: MoneyAnalysisRecord,
  requestedStart: CalendarDate,
  requestedEnd: CalendarDate,
  completeMonths: ReadonlySet<CalendarMonth>,
): SpendingAnomaly[] => {
  const anomalies: SpendingAnomaly[] = [];
  const ordered = [...record.transactions].sort((left, right) =>
    left.postedDate.localeCompare(right.postedDate),
  );

  for (const transaction of ordered) {
    if (
      transaction.postedDate < requestedStart ||
      transaction.postedDate > requestedEnd ||
      !completeMonths.has(calendarMonthForDate(transaction.postedDate))
    ) {
      continue;
    }
    const signedExpense = expenseByTransaction(transaction);
    if (BigDecimal.sign(signedExpense) >= 0) continue;
    const amount = moneyFrom(BigDecimal.abs(signedExpense));
    const trailing90 = ordered
      .filter(
        (candidate) =>
          candidate.accountId === transaction.accountId &&
          candidate.postedDate >= shiftCalendarDate(transaction.postedDate, -90) &&
          candidate.postedDate < transaction.postedDate &&
          BigDecimal.sign(expenseByTransaction(candidate)) < 0,
      )
      .map((candidate) => moneyFrom(BigDecimal.abs(expenseByTransaction(candidate))));
    if (
      coverageGaps(record.accounts, record.coverage, {
        start: shiftCalendarDate(transaction.postedDate, -90),
        end: transaction.postedDate,
      }).length === 0
    ) {
      const accountThreshold =
        trailing90.length === 0
          ? fiveHundred
          : BigDecimal.max(fiveHundred, BigDecimal.multiply(median(trailing90), four));
      if (BigDecimal.isGreaterThan(amount, accountThreshold)) {
        anomalies.push({ _tag: "LargeExpense", transactionId: transaction.id, amount });
      }
    }

    if (
      coverageGaps(record.accounts, record.coverage, {
        start: shiftCalendarDate(transaction.postedDate, -730),
        end: transaction.postedDate,
      }).length === 0
    ) {
      const seenPayee = ordered.some(
        (candidate) =>
          candidate.payee === transaction.payee &&
          candidate.postedDate >= shiftCalendarDate(transaction.postedDate, -730) &&
          candidate.postedDate < transaction.postedDate,
      );
      if (!seenPayee && BigDecimal.isGreaterThanOrEqualTo(amount, twoHundred)) {
        anomalies.push({
          _tag: "NewPayee",
          transactionId: transaction.id,
          payee: transaction.payee,
          amount,
        });
      }
    }
  }

  return anomalies;
};

const latestCoveredDate = (record: MoneyAnalysisRecord) =>
  [...new Set(record.coverage.map((segment) => segment.end))]
    .sort((left, right) => right.localeCompare(left))
    .find(
      (date) =>
        coverageGaps(record.accounts, record.coverage, { start: date, end: date }).length === 0,
    ) ?? null;

const monthlyAnalysis = (
  month: CalendarMonth,
  record: MoneyAnalysisRecord,
  completeMonths: ReadonlySet<CalendarMonth>,
): MonthlyMoneyAnalysis => {
  const window = calendarMonthWindow(month);
  const gaps = coverageGaps(record.accounts, record.coverage, window);
  if (gaps.length > 0) {
    return {
      month,
      coverage: { _tag: "Incomplete", gaps },
      income: null,
      netSpend: null,
      savingsRate: null,
      categories: [],
    };
  }

  const transactions = record.transactions.filter(
    (transaction) => transaction.postedDate >= window.start && transaction.postedDate <= window.end,
  );
  const income = sum(
    transactions.flatMap((transaction) =>
      transaction.ownedTransfer
        ? []
        : transaction.splits
            .filter((split) => split.categoryKind === "income")
            .map((split) => split.amount),
    ),
  );
  const signedExpenses = sum(transactions.map(expenseByTransaction));
  const netSpend = moneyFrom(BigDecimal.negate(signedExpenses));
  const categoryGroups = new Map<
    CategoryId,
    { readonly name: string; readonly amounts: Money[]; readonly ids: BankTransactionId[] }
  >();

  for (const transaction of transactions) {
    if (transaction.ownedTransfer) continue;
    for (const split of transaction.splits) {
      if (split.categoryKind !== "expense") continue;
      const current = categoryGroups.get(split.categoryId) ?? {
        name: split.categoryName,
        amounts: [],
        ids: [],
      };
      current.amounts.push(split.amount);
      current.ids.push(transaction.id);
      categoryGroups.set(split.categoryId, current);
    }
  }

  const priorMonths = [
    shiftCalendarMonth(month, -3),
    shiftCalendarMonth(month, -2),
    shiftCalendarMonth(month, -1),
  ];
  const categories = [...categoryGroups.entries()]
    .map(([categoryId, group]) => {
      const trailingThreeMonthAverage = priorMonths.every((prior) => completeMonths.has(prior))
        ? moneyFrom(
            BigDecimal.divideUnsafe(
              BigDecimal.sumAll(
                priorMonths.map((prior) => {
                  const priorWindow = calendarMonthWindow(prior);
                  return BigDecimal.negate(
                    BigDecimal.sumAll(
                      record.transactions.flatMap((transaction) =>
                        transaction.ownedTransfer ||
                        transaction.postedDate < priorWindow.start ||
                        transaction.postedDate > priorWindow.end
                          ? []
                          : transaction.splits
                              .filter((split) => split.categoryId === categoryId)
                              .map((split) => split.amount),
                      ),
                    ),
                  );
                }),
              ),
              three,
            ),
          )
        : null;

      return {
        categoryId,
        name: group.name,
        netSpend: moneyFrom(BigDecimal.negate(BigDecimal.sumAll(group.amounts))),
        trailingThreeMonthAverage,
        transactionIds: [...new Set(group.ids)],
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
  const savingsRate =
    BigDecimal.sign(income) > 0
      ? BigDecimal.divideUnsafe(BigDecimal.subtract(income, netSpend), income)
      : null;

  return {
    month,
    coverage: { _tag: "Complete" },
    income,
    netSpend,
    savingsRate,
    categories,
  };
};

export const analyzeMoney = (
  record: MoneyAnalysisRecord,
  startMonth: CalendarMonth,
  endMonth: CalendarMonth,
): MoneyAnalysis => {
  const requestedMonths = calendarMonthsBetween(startMonth, endMonth);
  const comparisonMonths = calendarMonthsBetween(shiftCalendarMonth(startMonth, -3), endMonth);
  const completeMonths = new Set(
    comparisonMonths.filter((month) => {
      const window = calendarMonthWindow(month);
      return coverageGaps(record.accounts, record.coverage, window).length === 0;
    }),
  );
  const months = requestedMonths.map((month) => monthlyAnalysis(month, record, completeMonths));
  const dataThrough = latestCoveredDate(record);
  const recurringCoverageComplete =
    dataThrough !== null &&
    coverageGaps(record.accounts, record.coverage, {
      start: shiftCalendarDate(dataThrough, -399),
      end: dataThrough,
    }).length === 0;
  const recurring =
    dataThrough === null || !recurringCoverageComplete
      ? []
      : recurringCharges(record.transactions, dataThrough);
  const requestedWindow = {
    start: calendarMonthWindow(startMonth).start,
    end: calendarMonthWindow(endMonth).end,
  };
  const anomalies = detectTransactionAnomalies(
    record,
    requestedWindow.start,
    requestedWindow.end,
    completeMonths,
  );

  for (const month of months) {
    if (month.coverage._tag !== "Complete") continue;
    for (const category of month.categories) {
      if (
        category.trailingThreeMonthAverage !== null &&
        BigDecimal.isGreaterThan(
          category.netSpend,
          BigDecimal.multiply(
            category.trailingThreeMonthAverage,
            BigDecimal.fromStringUnsafe("1.5"),
          ),
        ) &&
        BigDecimal.isGreaterThanOrEqualTo(
          BigDecimal.subtract(category.netSpend, category.trailingThreeMonthAverage),
          oneHundredFifty,
        )
      ) {
        anomalies.push({
          _tag: "CategorySpike",
          categoryId: category.categoryId,
          month: month.month,
          netSpend: category.netSpend,
          trailingAverage: category.trailingThreeMonthAverage,
        });
      }
    }
  }

  const complete = months.every((month) => month.coverage._tag === "Complete");
  const suggestions: SavingsSuggestion[] =
    complete && recurringCoverageComplete && dataThrough !== null
      ? recurring.map((charge) => ({
          title: `Review recurring charge: ${charge.payee}`,
          reasoning: `${charge.payee} recurs about every ${charge.cadenceDays} days.`,
          estimatedAnnualImpact: charge.estimatedAnnualSpend,
          dataThrough,
          transactionIds: charge.transactionIds,
        }))
      : [];

  return {
    months,
    recurringCharges: recurring,
    anomalies,
    suggestions,
    dataThrough,
  };
};

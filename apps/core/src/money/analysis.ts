import {
  CalendarDate,
  CalendarMonth,
  money,
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
import { BigDecimal, DateTime } from "effect";

import {
  calendarMonthForDate,
  calendarMonthsBetween,
  calendarMonthWindow,
  coverageGaps,
  fullyCoveredIntervals,
  isFullyCovered,
  shiftCalendarDate,
  shiftCalendarMonth,
  type CoverageSegment,
  type DateInterval,
} from "./coverage";
import { normalizeNarrative } from "./normalization";

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

const zero = money(BigDecimal.fromBigInt(0n));
const two = BigDecimal.fromBigInt(2n);
const three = BigDecimal.fromBigInt(3n);
const four = BigDecimal.fromBigInt(4n);
const year = BigDecimal.fromBigInt(365n);
const fivePercent = BigDecimal.fromStringUnsafe("0.05");
const onePercent = BigDecimal.fromStringUnsafe("0.01");
const spikeMultiple = BigDecimal.fromStringUnsafe("1.5");
const dollar = BigDecimal.fromBigInt(1n);
const twoHundred = BigDecimal.fromBigInt(200n);
const fiveHundred = BigDecimal.fromBigInt(500n);
const oneHundredFifty = BigDecimal.fromBigInt(150n);

/** The window each anomaly rule must see complete before it may claim anything. */
const largeExpenseWindow = 90;
const newPayeeWindow = 730;
const recurringWindow = 399;

const sum = (values: Iterable<BigDecimal.BigDecimal>) => money(BigDecimal.sumAll(values));

const median = (values: readonly Money[]): Money => {
  const sorted = [...values].sort(BigDecimal.Order);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 1
    ? sorted[middle]!
    : money(BigDecimal.divideUnsafe(BigDecimal.sum(sorted[middle - 1]!, sorted[middle]!), two));
};

const numericMedian = (values: readonly number[]) => {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

const dayGap = (earlier: CalendarDate, later: CalendarDate) =>
  (DateTime.toEpochMillis(DateTime.makeUnsafe(`${later}T00:00:00Z`)) -
    DateTime.toEpochMillis(DateTime.makeUnsafe(`${earlier}T00:00:00Z`))) /
  86_400_000;

const cadences = [
  { days: 7, tolerance: 2 },
  { days: 14, tolerance: 3 },
  { days: 30, tolerance: 4 },
  { days: 91, tolerance: 7 },
  { days: 365, tolerance: 10 },
];

const cadenceFor = (medianGap: number) =>
  cadences.find(({ days, tolerance }) => Math.abs(medianGap - days) <= tolerance)?.days;

/**
 * One transaction's contribution to spending: the signed sum of its expense
 * splits, so a refund reduces its own category rather than reading as income.
 * An owned transfer contributes nothing to either side.
 */
const expenseOf = (transaction: AnalysisTransaction) =>
  transaction.ownedTransfer
    ? zero
    : sum(
        transaction.splits
          .filter((split) => split.categoryKind === "expense")
          .map((split) => split.amount),
      );

const incomeOf = (transaction: AnalysisTransaction) =>
  transaction.ownedTransfer
    ? zero
    : sum(
        transaction.splits
          .filter((split) => split.categoryKind === "income")
          .map((split) => split.amount),
      );

interface AnalysedTransaction {
  readonly transaction: AnalysisTransaction;
  readonly expense: Money;
  readonly absoluteExpense: Money;
  readonly payeeKey: string;
}

const recurringCharges = (
  expenses: readonly AnalysedTransaction[],
  dataThrough: CalendarDate,
): readonly RecurringCharge[] => {
  const start = shiftCalendarDate(dataThrough, -recurringWindow);
  const byPayee = new Map<string, AnalysedTransaction[]>();

  for (const entry of expenses) {
    if (entry.transaction.postedDate < start || entry.transaction.postedDate > dataThrough) {
      continue;
    }

    const group = byPayee.get(entry.payeeKey);

    if (group === undefined) byPayee.set(entry.payeeKey, [entry]);
    else group.push(entry);
  }

  const recurring: RecurringCharge[] = [];

  for (const group of byPayee.values()) {
    if (group.length < 3) continue;

    const ordered = [...group].sort((left, right) =>
      left.transaction.postedDate.localeCompare(right.transaction.postedDate),
    );
    const amounts = ordered.map((entry) => entry.absoluteExpense);
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
      .map((entry, index) =>
        dayGap(ordered[index]!.transaction.postedDate, entry.transaction.postedDate),
      );
    const medianGap = numericMedian(gaps);
    const cadenceDays = cadenceFor(medianGap);

    if (cadenceDays === undefined) continue;

    const averageGap = gaps.reduce((total, gap) => total + gap, 0) / gaps.length;
    const deviation = Math.sqrt(
      gaps.reduce((total, gap) => total + (gap - averageGap) ** 2, 0) / gaps.length,
    );

    if (deviation > medianGap * 0.2) continue;

    const latestAmount = amounts.at(-1)!;
    const previousAmount = amounts.at(-2)!;
    const absoluteChange = BigDecimal.abs(BigDecimal.subtract(latestAmount, previousAmount));
    const relativeChange = BigDecimal.divideUnsafe(absoluteChange, previousAmount);

    recurring.push({
      // The latest form of the payee, so a merchant that renamed itself reads
      // as the operator last saw it on their statement.
      payee: ordered.at(-1)!.transaction.payee,
      cadenceDays,
      typicalAmount,
      latestAmount,
      estimatedAnnualSpend: money(
        BigDecimal.multiply(
          typicalAmount,
          BigDecimal.divideUnsafe(year, BigDecimal.fromBigInt(BigInt(cadenceDays))),
        ),
      ),
      priceChange:
        BigDecimal.isGreaterThan(relativeChange, onePercent) &&
        BigDecimal.isGreaterThanOrEqualTo(absoluteChange, dollar)
          ? { previousAmount, currentAmount: latestAmount }
          : null,
      transactionIds: ordered.map((entry) => entry.transaction.id),
    });
  }

  return recurring.sort((left, right) => left.payee.localeCompare(right.payee));
};

const transactionAnomalies = (
  expenses: readonly AnalysedTransaction[],
  covered: readonly DateInterval[],
  requested: DateInterval,
  completeMonths: ReadonlySet<CalendarMonth>,
): readonly SpendingAnomaly[] => {
  const anomalies: SpendingAnomaly[] = [];
  const byAccount = new Map<BankAccount["id"], AnalysedTransaction[]>();
  const firstSeen = new Map<string, CalendarDate>();

  for (const entry of expenses) {
    const account = byAccount.get(entry.transaction.accountId);

    if (account === undefined) byAccount.set(entry.transaction.accountId, [entry]);
    else account.push(entry);

    const seen = firstSeen.get(entry.payeeKey);

    if (seen === undefined || entry.transaction.postedDate < seen) {
      firstSeen.set(entry.payeeKey, entry.transaction.postedDate);
    }
  }

  for (const entry of expenses) {
    const { transaction, absoluteExpense } = entry;

    if (
      transaction.postedDate < requested.start ||
      transaction.postedDate > requested.end ||
      !completeMonths.has(calendarMonthForDate(transaction.postedDate))
    ) {
      continue;
    }

    if (
      isFullyCovered(covered, {
        start: shiftCalendarDate(transaction.postedDate, -largeExpenseWindow),
        end: transaction.postedDate,
      })
    ) {
      const trailing = (byAccount.get(transaction.accountId) ?? [])
        .filter(
          (candidate) =>
            candidate.transaction.postedDate < transaction.postedDate &&
            candidate.transaction.postedDate >=
              shiftCalendarDate(transaction.postedDate, -largeExpenseWindow),
        )
        .map((candidate) => candidate.absoluteExpense);
      const threshold =
        trailing.length === 0
          ? fiveHundred
          : BigDecimal.max(fiveHundred, BigDecimal.multiply(median(trailing), four));

      if (BigDecimal.isGreaterThan(absoluteExpense, threshold)) {
        anomalies.push({
          _tag: "LargeExpense",
          transactionId: transaction.id,
          amount: absoluteExpense,
        });
      }
    }

    if (
      firstSeen.get(entry.payeeKey) === transaction.postedDate &&
      BigDecimal.isGreaterThanOrEqualTo(absoluteExpense, twoHundred) &&
      isFullyCovered(covered, {
        start: shiftCalendarDate(transaction.postedDate, -newPayeeWindow),
        end: transaction.postedDate,
      })
    ) {
      anomalies.push({
        _tag: "NewPayee",
        transactionId: transaction.id,
        payee: transaction.payee,
        amount: absoluteExpense,
      });
    }
  }

  return anomalies;
};

const monthlyAnalysis = (
  month: CalendarMonth,
  record: MoneyAnalysisRecord,
  completeMonths: ReadonlySet<CalendarMonth>,
  netSpendByCategoryMonth: ReadonlyMap<string, Money>,
): MonthlyMoneyAnalysis => {
  const window = calendarMonthWindow(month);

  if (!completeMonths.has(month)) {
    return {
      month,
      coverage: {
        _tag: "Incomplete",
        gaps: coverageGaps(record.accounts, record.coverage, window),
      },
      income: null,
      netSpend: null,
      savingsRate: null,
      categories: [],
    };
  }

  const transactions = record.transactions.filter(
    (transaction) => transaction.postedDate >= window.start && transaction.postedDate <= window.end,
  );
  const income = sum(transactions.map(incomeOf));
  const netSpend = money(BigDecimal.negate(BigDecimal.sumAll(transactions.map(expenseOf))));
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
  // A trailing average that silently shortened its denominator would read a
  // missing month as a month without spending.
  const priorMonthsComplete = priorMonths.every((prior) => completeMonths.has(prior));
  const categories = [...categoryGroups.entries()]
    .map(([categoryId, group]) => ({
      categoryId,
      name: group.name,
      netSpend: money(BigDecimal.negate(BigDecimal.sumAll(group.amounts))),
      trailingThreeMonthAverage: priorMonthsComplete
        ? money(
            BigDecimal.divideUnsafe(
              BigDecimal.sumAll(
                priorMonths.map(
                  (prior) => netSpendByCategoryMonth.get(`${categoryId} ${prior}`) ?? zero,
                ),
              ),
              three,
            ),
          )
        : null,
      transactionIds: [...new Set(group.ids)],
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  return {
    month,
    coverage: { _tag: "Complete" },
    income,
    netSpend,
    savingsRate:
      BigDecimal.sign(income) > 0
        ? BigDecimal.divideUnsafe(BigDecimal.subtract(income, netSpend), income)
        : null,
    categories,
  };
};

/** Net spend per category and calendar month, keyed once for trailing averages. */
const netSpendByCategoryMonth = (transactions: readonly AnalysisTransaction[]) => {
  const totals = new Map<string, BigDecimal.BigDecimal>();

  for (const transaction of transactions) {
    if (transaction.ownedTransfer) continue;

    const month = calendarMonthForDate(transaction.postedDate);

    for (const split of transaction.splits) {
      if (split.categoryKind !== "expense") continue;

      const key = `${split.categoryId} ${month}`;

      totals.set(key, BigDecimal.sum(totals.get(key) ?? zero, split.amount));
    }
  }

  return new Map(
    [...totals].map(([key, total]) => [key, money(BigDecimal.negate(total))] as const),
  );
};

export const analyzeMoney = (
  record: MoneyAnalysisRecord,
  startMonth: CalendarMonth,
  endMonth: CalendarMonth,
): MoneyAnalysis => {
  const covered = fullyCoveredIntervals(record.accounts, record.coverage);
  const requestedMonths = calendarMonthsBetween(startMonth, endMonth);
  const completeMonths = new Set(
    calendarMonthsBetween(shiftCalendarMonth(startMonth, -3), endMonth).filter((month) =>
      isFullyCovered(covered, calendarMonthWindow(month)),
    ),
  );
  const categoryMonthTotals = netSpendByCategoryMonth(record.transactions);
  const months = requestedMonths.map((month) =>
    monthlyAnalysis(month, record, completeMonths, categoryMonthTotals),
  );
  const expenses = record.transactions
    .map((transaction) => {
      const expense = expenseOf(transaction);

      return {
        transaction,
        expense,
        absoluteExpense: money(BigDecimal.abs(expense)),
        payeeKey: normalizeNarrative(transaction.payee),
      };
    })
    .filter((entry) => BigDecimal.sign(entry.expense) < 0)
    .sort((left, right) => left.transaction.postedDate.localeCompare(right.transaction.postedDate));
  const dataThrough = latestCoveredDate(record.coverage, covered);
  const recurring =
    dataThrough === null ||
    !isFullyCovered(covered, {
      start: shiftCalendarDate(dataThrough, -recurringWindow),
      end: dataThrough,
    })
      ? []
      : recurringCharges(expenses, dataThrough);
  const anomalies = [
    ...transactionAnomalies(
      expenses,
      covered,
      {
        start: calendarMonthWindow(startMonth).start,
        end: calendarMonthWindow(endMonth).end,
      },
      completeMonths,
    ),
    ...months.flatMap((month) =>
      month.categories.flatMap((category): readonly SpendingAnomaly[] =>
        category.trailingThreeMonthAverage !== null &&
        BigDecimal.isGreaterThan(
          category.netSpend,
          BigDecimal.multiply(category.trailingThreeMonthAverage, spikeMultiple),
        ) &&
        BigDecimal.isGreaterThanOrEqualTo(
          BigDecimal.subtract(category.netSpend, category.trailingThreeMonthAverage),
          oneHundredFifty,
        )
          ? [
              {
                _tag: "CategorySpike",
                categoryId: category.categoryId,
                month: month.month,
                netSpend: category.netSpend,
                trailingAverage: category.trailingThreeMonthAverage,
              },
            ]
          : [],
      ),
    ),
  ];
  const complete = months.every((month) => month.coverage._tag === "Complete");

  return {
    months,
    recurringCharges: recurring,
    anomalies,
    suggestions:
      complete && dataThrough !== null
        ? recurring.map((charge): SavingsSuggestion => ({
            title: `Review recurring charge: ${charge.payee}`,
            reasoning: `${charge.payee} recurs about every ${charge.cadenceDays} days at ${BigDecimal.format(charge.typicalAmount)} a time.`,
            estimatedAnnualImpact: charge.estimatedAnnualSpend,
            dataThrough,
            transactionIds: charge.transactionIds,
          }))
        : [],
    dataThrough,
  };
};

/**
 * The newest day every required account is covered through. Only a segment end
 * can be that day, so the segment ends are the whole candidate set.
 */
const latestCoveredDate = (
  segments: readonly CoverageSegment[],
  covered: readonly DateInterval[],
) =>
  [...new Set(segments.map((segment) => segment.end))]
    .sort((left, right) => right.localeCompare(left))
    .find((date) => isFullyCovered(covered, { start: date, end: date })) ?? null;

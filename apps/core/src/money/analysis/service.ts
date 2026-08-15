import {
  Internal,
  NotFound,
  type MoneyAnalysis,
  type MonthAnalysis,
  type RecurringCharge,
  type SavingsSuggestion,
  type SpendingAnomaly,
} from "@ironcage/contracts/schema";
import {
  addDays,
  Aud,
  BankAccountId,
  BankTransactionId,
  CalendarDate,
  CategoryId,
  CategoryKind,
  daysBetween,
  monthOf,
} from "@ironcage/domain";
import { BigDecimal, Effect, Option, Schema } from "effect";

import { persistenceToBoundary } from "../../persistence/error";
import { decodeRows, Postgres, type SqlExecutor } from "../../persistence/postgres";
import { loadCoverageSummary } from "../accounts/service";

/**
 * The proposed analysis configuration from the Money chapter. Every value is
 * operator-tunable in principle; these are the recorded defaults.
 */
export const analysisConfig = {
  recurringWindowDays: 400,
  recurringMinOccurrences: 3,
  recurringAmountTolerance: "0.05",
  recurringGapDeviation: "0.2",
  cadenceBuckets: [
    { days: 7, tolerance: 2 },
    { days: 14, tolerance: 3 },
    { days: 30, tolerance: 4 },
    { days: 91, tolerance: 7 },
    { days: 365, tolerance: 10 },
  ],
  priceChangeMinRatio: "0.01",
  priceChangeMinAmount: "1.00",
  largeExpenseFloor: "500",
  largeExpenseMultiple: "4",
  largeExpenseMedianDays: 90,
  newPayeeLookbackDays: 730,
  newPayeeMinAmount: "200",
  spikeMultiple: "1.5",
  spikeMinExcess: "150",
  steadyChargeAnnualFloor: "120",
} as const;

export interface SplitLine {
  readonly transactionId: BankTransactionId;
  readonly accountId: BankAccountId;
  readonly postedDate: CalendarDate;
  readonly payee: string;
  readonly categoryId: CategoryId;
  readonly categoryName: string;
  readonly kind: CategoryKind;
  readonly amount: BigDecimal.BigDecimal;
}

const SplitLineRow = Schema.Struct({
  transactionId: BankTransactionId,
  accountId: BankAccountId,
  postedDate: CalendarDate,
  payee: Schema.String,
  categoryId: CategoryId,
  categoryName: Schema.String,
  kind: CategoryKind,
  amount: Schema.BigDecimalFromString,
});

/**
 * Effective splits joined to their transactions and categories, excluding
 * both legs of every confirmed owned transfer: source observations and
 * transfers never enter an aggregate.
 */
export const loadSplitLines = (sql: SqlExecutor) =>
  Effect.gen(function* () {
    const rows = yield* sql.query(
      "load analysis split lines",
      `SELECT t.id AS "transactionId", t.account_id AS "accountId", t.posted_date AS "postedDate",
              t.derived_payee AS payee, s.category_id AS "categoryId", c.name AS "categoryName",
              c.kind, s.amount::text AS amount
         FROM bank_transactions t
         JOIN transaction_splits s
           ON s.transaction_id = t.id
          AND s.revision = (SELECT max(revision) FROM transaction_splits latest
                             WHERE latest.transaction_id = t.id)
         JOIN categories c ON c.id = s.category_id
        WHERE NOT EXISTS (SELECT 1 FROM transfer_matches m
                           WHERE m.status = 'confirmed'
                             AND (m.transaction_a = t.id OR m.transaction_b = t.id))
        ORDER BY t.posted_date, t.id`,
    );
    return yield* decodeRows("decode analysis split lines", SplitLineRow, rows);
  });

const decodeAud = Schema.decodeUnknownSync(Aud);
const zero = BigDecimal.fromBigInt(0n);
const decimal = BigDecimal.fromStringUnsafe;

const money = (value: BigDecimal.BigDecimal) =>
  decodeAud(BigDecimal.format(BigDecimal.round(value, { scale: 2, mode: "half-even" })));

const previousMonths = (month: string, count: number): string[] => {
  const cursor = new Date(`${month}-01T00:00:00Z`);
  const result: string[] = [];
  for (let step = 0; step < count; step += 1) {
    cursor.setUTCMonth(cursor.getUTCMonth() - 1);
    result.push(cursor.toISOString().slice(0, 7));
  }
  return result;
};

interface MonthTotals {
  income: BigDecimal.BigDecimal;
  spendSum: BigDecimal.BigDecimal;
  categories: Map<CategoryId, { name: string; kind: CategoryKind; sum: BigDecimal.BigDecimal }>;
}

/** Monthly aggregates over effective splits; comparisons use complete months only. */
export const computeMonths = (
  lines: readonly SplitLine[],
  completeMonths: ReadonlySet<string>,
): readonly MonthAnalysis[] => {
  const totals = new Map<string, MonthTotals>();
  const monthFor = (month: string): MonthTotals => {
    const existing = totals.get(month);
    if (existing !== undefined) return existing;
    const created: MonthTotals = { income: zero, spendSum: zero, categories: new Map() };
    totals.set(month, created);
    return created;
  };

  for (const month of completeMonths) monthFor(month);
  for (const line of lines) {
    const month = monthFor(monthOf(line.postedDate));
    if (line.kind === "income") month.income = BigDecimal.sum(month.income, line.amount);
    else month.spendSum = BigDecimal.sum(month.spendSum, line.amount);

    const category = month.categories.get(line.categoryId);
    if (category === undefined) {
      month.categories.set(line.categoryId, {
        name: line.categoryName,
        kind: line.kind,
        sum: line.amount,
      });
    } else {
      category.sum = BigDecimal.sum(category.sum, line.amount);
    }
  }

  const months = [...totals.keys()].sort();
  const netSpendByMonth = new Map(
    months.map((month) => [month, BigDecimal.negate(totals.get(month)!.spendSum)]),
  );

  return months.map((month) => {
    const data = totals.get(month)!;
    const netSpend = netSpendByMonth.get(month)!;
    const complete = completeMonths.has(month);

    const ratio = BigDecimal.isPositive(data.income)
      ? BigDecimal.divide(BigDecimal.subtract(data.income, netSpend), data.income)
      : Option.none();
    const savingsRate = Option.isSome(ratio)
      ? BigDecimal.format(BigDecimal.round(ratio.value, { scale: 4, mode: "half-even" }))
      : null;

    const window = previousMonths(month, 3);
    const trailing =
      complete && window.every((previous) => completeMonths.has(previous))
        ? money(
            BigDecimal.divideUnsafe(
              window.reduce(
                (sum, previous) => BigDecimal.sum(sum, netSpendByMonth.get(previous) ?? zero),
                zero,
              ),
              decimal("3"),
            ),
          )
        : null;

    return {
      month,
      complete,
      income: money(data.income),
      netSpend: money(netSpend),
      savingsRate,
      trailingThreeMonthNetSpend: trailing,
      categories: [...data.categories.entries()]
        .map(([categoryId, category]) => ({
          categoryId,
          name: category.name,
          kind: category.kind,
          amount: money(
            category.kind === "expense" ? BigDecimal.negate(category.sum) : category.sum,
          ),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  });
};

const median = (values: readonly BigDecimal.BigDecimal[]): BigDecimal.BigDecimal => {
  const sorted = [...values].sort(BigDecimal.Order);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : BigDecimal.divideUnsafe(BigDecimal.sum(sorted[middle - 1]!, sorted[middle]!), decimal("2"));
};

const numericMedian = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

interface RecurringGroup extends RecurringCharge {
  readonly transactionIds: readonly BankTransactionId[];
}

/** Recurring-charge detection over case-folded derived payees. */
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
    const medianAmount = median(amounts);
    const allowed = BigDecimal.multiply(medianAmount, tolerance);
    if (
      !amounts.every((amount) =>
        BigDecimal.isLessThanOrEqualTo(
          BigDecimal.abs(BigDecimal.subtract(amount, medianAmount)),
          allowed,
        ),
      )
    ) {
      continue;
    }

    const gaps = occurrences
      .slice(1)
      .map((line, index) => daysBetween(occurrences[index]!.postedDate, line.postedDate));
    const medianGap = numericMedian(gaps);
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
      medianAmount: money(medianAmount),
      annualizedAmount: money(
        BigDecimal.divideUnsafe(
          BigDecimal.multiply(medianAmount, decimal("365")),
          decimal(String(bucket.days)),
        ),
      ),
      lastSeen: last.postedDate,
      priceChange: changed
        ? { from: money(previousAmount), to: money(lastAmount), on: last.postedDate }
        : null,
      transactionIds: [...new Set(occurrences.map((line) => line.transactionId))],
    });
  }

  return results.sort((a, b) => a.payee.localeCompare(b.payee));
};

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

/** The three proposed anomaly rules, deduplicated on (rule, subject, month). */
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
    // Large expense: beyond the larger of the floor or four times the
    // account's trailing 90-day median absolute expense.
    const windowStart = addDays(transaction.postedDate, -analysisConfig.largeExpenseMedianDays);
    const priors: BigDecimal.BigDecimal[] = [];
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const prior = transactions[cursor]!;
      if (prior.postedDate < windowStart) break;
      if (prior.accountId === transaction.accountId) priors.push(prior.magnitude);
    }
    const baseline = priors.length === 0 ? zero : median(priors);
    const threshold = BigDecimal.max(floor, BigDecimal.multiply(baseline, multiple));
    if (BigDecimal.isGreaterThan(transaction.magnitude, threshold)) {
      record({
        rule: "large_expense",
        month: monthOf(transaction.postedDate),
        subject: transaction.payee,
        amount: money(transaction.magnitude),
        detail: `${BigDecimal.format(transaction.magnitude)} exceeds the ${BigDecimal.format(threshold)} threshold`,
      });
    }

    // New payee: unseen in the trailing 730 days and at least the floor.
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
        amount: money(transaction.magnitude),
        detail: `first appearance of ${transaction.payee} within ${analysisConfig.newPayeeLookbackDays} days`,
      });
    }
    lastSeenByPayee.set(payeeKey, transaction.postedDate);
  }

  // Category spike: more than 1.5× the trailing three-complete-month average
  // and at least A$150 above it, judged only on complete months.
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

/** Savings suggestions; unavailable when the supporting window has a gap. */
export const computeSuggestions = (
  recurring: readonly RecurringGroup[],
  completeMonths: ReadonlySet<string>,
  dataThrough: CalendarDate,
): { readonly suggestions: readonly SavingsSuggestion[]; readonly unavailable: string | null } => {
  // A gap is a hole inside covered history, not the absence of history
  // before the record begins: the check runs from the later of the window
  // start and the earliest complete month.
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
        annualAmount: money(
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

export const getMoneyAnalysis = (): Effect.Effect<MoneyAnalysis, NotFound | Internal, Postgres> =>
  Effect.gen(function* () {
    const postgres = yield* Postgres;

    return yield* postgres.readTransaction((sql) =>
      Effect.gen(function* () {
        const coverage = yield* loadCoverageSummary(sql);
        const lines = yield* loadSplitLines(sql);
        const complete = new Set(coverage.completeMonths);

        const months = computeMonths(lines, complete);
        const recurring =
          coverage.dataThrough === null ? [] : computeRecurring(lines, coverage.dataThrough);
        const anomalies = computeAnomalies(lines, months, complete);
        const { suggestions, unavailable } =
          coverage.dataThrough === null
            ? { suggestions: [], unavailable: "no covered history yet" as string | null }
            : computeSuggestions(recurring, complete, coverage.dataThrough);

        return {
          months,
          recurring: recurring.map(({ transactionIds: _, ...group }) => group),
          anomalies,
          suggestions,
          suggestionsUnavailable: unavailable,
          completeMonths: coverage.completeMonths,
          dataThrough: coverage.dataThrough,
        };
      }),
    );
  }).pipe(persistenceToBoundary);

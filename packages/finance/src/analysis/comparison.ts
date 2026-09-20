import type {
  AnalysisQuery,
  ComparisonResult,
  Contributor,
  ContributorsResult,
  GroupBy,
  MetricValue,
  OverviewResult,
  Period,
  PeriodResult,
} from "@repo/contracts/finance";

import { currencyExponent } from "../money.ts";
import {
  contributionGroups,
  contributorSnapshot,
  groupLabel,
  selectContributions,
  type Contribution,
} from "./contributions.ts";
import { decimalRatio, roundHalfEven } from "./decimal.ts";
import { calculateOverview, type AnalysisSnapshot } from "./measures.ts";
import { daysInPeriod } from "./periods.ts";

type Rational = { numerator: bigint; denominator: bigint };
const subtract = (a: Rational, b: Rational): Rational => ({
  numerator: a.numerator * b.denominator - b.numerator * a.denominator,
  denominator: a.denominator * b.denominator,
});
const sum = (facts: readonly Contribution[]) =>
  facts.reduce((total, fact) => total + fact.amount, 0n);
function metric(query: AnalysisQuery, value: Rational | null, normalized: boolean): MetricValue {
  if (!value)
    return {
      kind: "unavailable",
      reason: "Missing coverage, balance anchors, or a positive income denominator.",
    };
  if (normalized && query.normalization === "dailyAverage")
    return {
      kind: "dailyAverage",
      amount: {
        currency: query.currency,
        value: decimalRatio(
          value.numerator,
          value.denominator * 10n ** BigInt(currencyExponent(query.currency)),
        ),
      },
    };
  if (query.measure === "surplusRate")
    return { kind: "percent", value: decimalRatio(value.numerator, value.denominator) };
  if (query.measure === "purchaseCount")
    return { kind: "count", count: Number(value.numerator / value.denominator) };
  return {
    kind: "money",
    amount: { currency: query.currency, minor: roundHalfEven(value.numerator, value.denominator) },
  };
}
function periodCalculation(
  overview: OverviewResult,
  query: AnalysisQuery,
  facts: readonly Contribution[],
) {
  const period = overview.period;
  const purchaseIds = new Set(
    facts.filter((fact) => fact.kind === "purchase").map((fact) => fact.eventId),
  );
  const purchaseCount = purchaseIds.size;
  const days = daysInPeriod(period);
  let total: Rational | null = { numerator: sum(facts), denominator: 1n };
  if (query.measure === "purchaseCount")
    total = { numerator: BigInt(purchaseCount), denominator: 1n };
  if (query.measure === "surplusRate") {
    const income = facts
      .filter((fact) => fact.allocation?.role === "income")
      .reduce((amount, fact) => amount + fact.amount, 0n);
    total = income > 0n ? { numerator: sum(facts) * 100n, denominator: income } : null;
  }
  if (query.measure === "cashBalanceChange" && overview.cashBalanceChange === null) total = null;
  if (
    query.measure === "netPrincipalReduction" &&
    (!overview.loans.length || overview.loans.some((loan) => loan.netPrincipalReduction === null))
  )
    total = null;
  const complete =
    overview.coverage.accounts.length > 0 &&
    overview.coverage.accounts.every((account) => !account.missing.length);
  const value =
    query.normalization === "dailyAverage"
      ? complete && total
        ? { numerator: total.numerator, denominator: total.denominator * BigInt(days) }
        : null
      : total;
  const purchaseAmount = sum(facts.filter((fact) => fact.kind === "purchase"));
  const result: PeriodResult = {
    period,
    basis: query.basis,
    total: metric(query, total, false),
    value: metric(query, value, true),
    days,
    coverage: overview.coverage,
    purchaseCount,
    averagePurchase: purchaseCount
      ? {
          currency: query.currency,
          value: decimalRatio(
            purchaseAmount,
            BigInt(purchaseCount) * 10n ** BigInt(currencyExponent(query.currency)),
          ),
        }
      : null,
  };
  return { result, value };
}
function deltaValues(query: AnalysisQuery, current: Rational | null, previous: Rational | null) {
  const delta = current && previous ? subtract(current, previous) : null;
  return {
    delta: metric(query, delta, true),
    relativeChange:
      delta && previous && previous.numerator !== 0n
        ? decimalRatio(
            delta.numerator * previous.denominator * 100n,
            delta.denominator * previous.numerator,
          )
        : null,
  };
}
export function calculateComparison(
  snapshot: AnalysisSnapshot,
  query: AnalysisQuery,
  periods: { current: Period; previous: Period },
  calculatedAt: string,
  selected?: { current: readonly Contribution[]; previous: readonly Contribution[] },
): ComparisonResult {
  return compareOverviews(
    query,
    {
      current: calculateOverview(snapshot, query, periods.current, calculatedAt),
      previous: calculateOverview(snapshot, query, periods.previous, calculatedAt),
    },
    selected ?? {
      current: selectContributions(snapshot, query, periods.current),
      previous: selectContributions(snapshot, query, periods.previous),
    },
  );
}
function compareOverviews(
  query: AnalysisQuery,
  overviews: { current: OverviewResult; previous: OverviewResult },
  selected: { current: readonly Contribution[]; previous: readonly Contribution[] },
): ComparisonResult {
  const current = periodCalculation(overviews.current, query, selected.current);
  const previous = periodCalculation(overviews.previous, query, selected.previous);
  return {
    query,
    accountIds: overviews.current.accountIds,
    calculatedAt: overviews.current.calculatedAt,
    calculationVersion: "history-1",
    current: current.result,
    previous: previous.result,
    ...deltaValues(query, current.value, previous.value),
  };
}
function decomposition(
  query: AnalysisQuery,
  current: readonly Contribution[],
  previous: readonly Contribution[],
) {
  const n1 = BigInt(new Set(current.map((fact) => fact.eventId)).size);
  const n0 = BigInt(new Set(previous.map((fact) => fact.eventId)).size);
  if (
    query.normalization !== "total" ||
    !["grossCosts", "netPersonalCosts"].includes(query.measure) ||
    n1 === 0n ||
    n0 === 0n ||
    [...current, ...previous].some((fact) => fact.kind !== "purchase")
  )
    return { frequencyContribution: null, averageCostContribution: null };
  const t1 = sum(current),
    t0 = sum(previous),
    denominator = 2n * n0 * n1;
  const frequency = (n1 - n0) * (t0 * n1 + t1 * n0);
  const average = (t1 - t0) * denominator - frequency;
  const floor = (numerator: bigint) =>
    numerator / denominator - (numerator < 0n && numerator % denominator !== 0n ? 1n : 0n);
  let frequencyMinor = floor(frequency);
  let averageMinor = floor(average);
  const remaining = t1 - t0 - frequencyMinor - averageMinor;
  if (remaining > 0n) {
    if (frequency - frequencyMinor * denominator > average - averageMinor * denominator)
      frequencyMinor += remaining;
    else averageMinor += remaining;
  }
  return {
    frequencyContribution: { currency: query.currency, minor: frequencyMinor },
    averageCostContribution: { currency: query.currency, minor: averageMinor },
  };
}
export function calculateContributors(
  snapshot: AnalysisSnapshot,
  query: AnalysisQuery,
  groupBy: GroupBy,
  periods: { current: Period; previous: Period },
  calculatedAt: string,
): ContributorsResult {
  const current = selectContributions(snapshot, query, periods.current),
    previous = selectContributions(snapshot, query, periods.previous);
  const overviews = {
    current: calculateOverview(snapshot, query, periods.current, calculatedAt),
    previous: calculateOverview(snapshot, query, periods.previous, calculatedAt),
  };
  const comparison = compareOverviews(query, overviews, {
    current,
    previous,
  });
  const keys = [
    ...new Set([...current, ...previous].flatMap((fact) => contributionGroups(fact, groupBy))),
  ];
  const all = keys.map((key) => {
    const selected = {
      current: current.filter((fact) => contributionGroups(fact, groupBy).includes(key)),
      previous: previous.filter((fact) => contributionGroups(fact, groupBy).includes(key)),
    };
    const result =
      groupBy === "account"
        ? calculateComparison(
            contributorSnapshot(snapshot, groupBy, new Set([key])),
            query,
            periods,
            calculatedAt,
            selected,
          )
        : compareOverviews(query, overviews, selected);
    return {
      key,
      label: groupLabel(snapshot, groupBy, key),
      current: result.current,
      previous: result.previous,
      delta: result.delta,
      relativeChange: result.relativeChange,
      incomplete: [result.current, result.previous].some(
        (value) =>
          !value.coverage.accounts.length ||
          value.coverage.accounts.some((account) => account.missing.length > 0),
      ),
      ...decomposition(query, selected.current, selected.previous),
    } satisfies Contributor;
  });
  const magnitude = (value: MetricValue) =>
    value.kind === "money"
      ? { n: value.amount.minor, d: 1n }
      : value.kind === "count"
        ? { n: BigInt(value.count), d: 1n }
        : value.kind === "percent" || value.kind === "dailyAverage"
          ? {
              n: BigInt(
                (value.kind === "percent" ? value.value : value.amount.value).replace(".", ""),
              ),
              d: 1000000n,
            }
          : { n: 0n, d: 1n };
  all.sort((a, b) => {
    const av = magnitude(a.delta),
      bv = magnitude(b.delta);
    const left = (av.n < 0n ? -av.n : av.n) * bv.d,
      right = (bv.n < 0n ? -bv.n : bv.n) * av.d;
    return left === right ? a.key.localeCompare(b.key) : left > right ? -1 : 1;
  });
  const overlap =
    groupBy === "tag" ||
    groupBy === "personalEvent" ||
    query.measure === "surplusRate" ||
    (query.measure === "purchaseCount" && groupBy !== "account");
  const rows = overlap ? all : all.slice(0, 10);
  const remainder =
    overlap || rows.length === all.length ? null : contributorRemainder(comparison.delta, rows);
  return { comparison, groupBy, rows, remainder, overlap };
}

function contributorRemainder(total: MetricValue, rows: readonly Contributor[]): MetricValue {
  switch (total.kind) {
    case "money":
      return {
        ...total,
        amount: {
          ...total.amount,
          minor:
            total.amount.minor -
            rows.reduce(
              (sum, row) => sum + (row.delta.kind === "money" ? row.delta.amount.minor : 0n),
              0n,
            ),
        },
      };
    case "count":
      return {
        ...total,
        count:
          total.count -
          rows.reduce((sum, row) => sum + (row.delta.kind === "count" ? row.delta.count : 0), 0),
      };
    case "dailyAverage":
      return {
        ...total,
        amount: {
          ...total.amount,
          value: decimalRatio(
            BigInt(total.amount.value.replace(".", "")) -
              rows.reduce(
                (sum, row) =>
                  sum +
                  (row.delta.kind === "dailyAverage"
                    ? BigInt(row.delta.amount.value.replace(".", ""))
                    : 0n),
                0n,
              ),
            1000000n,
          ),
        },
      };
    case "percent":
    case "unavailable":
      return total;
  }
}

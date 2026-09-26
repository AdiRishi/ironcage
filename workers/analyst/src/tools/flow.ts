import type { RecordLink } from "@repo/contracts/analyst";
import {
  CategoryScope,
  ComparisonSelection,
  CountedScope,
  CoverageState,
  FinanceError,
  FlowDirection,
  type FlowStream,
  type Money,
  MonthsSelection,
  type Scope,
} from "@repo/contracts/finance";
import { compareMoney, leftOver, monthLabel, periodLabel, wholeMonths } from "@repo/finance";
import type { Api } from "@repo/infra/api";
import { Effect, Schema } from "effect";
import { Tool } from "effect/unstable/ai";

import {
  change,
  changePercent,
  cite,
  FigureView,
  money,
  placedBy,
  register,
  view,
} from "../evidence/present.ts";
import { TurnEvidence } from "../evidence/service.ts";
import { monthReads } from "./coverage.ts";
import { flagNotUnderstood, presentSpendingFigures, SpendingFiguresView } from "./spending.ts";

// The comparison period's amount and the change from it. Null when that period has no
// records to compare with.
const Compared = Schema.NullOr(Schema.Struct({ amount: FigureView, change: FigureView }));

export const ReadFlow = Tool.make("ReadFlow", {
  description:
    "Money in and out over a span of whole months against a comparison, as the overview " +
    "shows it: what came in and went out, what was left over, each stream of money in " +
    "and out, and the categories whose spending changed most. Read a spending stream " +
    "further with ReadSpending, and list the transactions behind any stream with " +
    "ListTransactions and its scope.",
  parameters: Schema.Struct({ period: MonthsSelection, comparison: ComparisonSelection }),
  success: Schema.Struct({
    period: Schema.String,
    comparedWith: Schema.String,
    comparisonRecords: CoverageState,
    cameIn: Schema.Struct({ amount: FigureView, comparison: Compared }),
    wentOut: Schema.Struct({ amount: FigureView, comparison: Compared }),
    // What came in less what went out: left over when at least as much came in as went
    // out, and short by the rest otherwise. One of the two is null.
    leftOver: Schema.NullOr(FigureView),
    shortBy: Schema.NullOr(FigureView),
    // Money moved between your own accounts, which neither came in nor went out.
    betweenYourAccounts: FigureView,
    spending: Schema.Struct({
      amount: FigureView,
      comparison: Compared,
      percentChange: Schema.NullOr(FigureView),
    }),
    income: FigureView,
    // Money in by income category, then borrowing, money from your other accounts, and
    // money not yet understood. Money out by spending category, then loan principal,
    // money to your other accounts, and money not yet understood. Only spending streams
    // are compared.
    streams: Schema.Array(
      Schema.Struct({
        direction: FlowDirection,
        label: Schema.String,
        scope: CountedScope,
        amount: FigureView,
        comparison: Compared,
        percentChange: Schema.NullOr(FigureView),
      }),
    ),
    largestChanges: Schema.Array(
      Schema.Struct({
        label: Schema.String,
        parent: Schema.NullOr(Schema.String),
        category: CategoryScope,
        figures: SpendingFiguresView,
      }),
    ),
  }),
  failure: FinanceError,
  failureMode: "return",
  dependencies: [TurnEvidence],
});

export const readFlow = (api: Pick<Api, "getPeriodFlow">) =>
  Effect.fn("ReadFlow")(function* (params: Tool.Parameters<typeof ReadFlow>) {
    const evidence = yield* TurnEvidence;
    const flow = yield* api.getPeriodFlow({
      ...params,
      basis: "spending",
      currency: evidence.currency,
    });
    const compared = flow.comparisonCoverage.state !== "missing";
    const label = periodLabel(flow.period);
    const since = periodLabel(flow.comparison);
    const changed = `change from ${since} to ${label}`;
    const read = placedBy({
      period: flow.period,
      comparison: compared ? flow.comparison : null,
      basis: flow.basis,
      calculatedAt: flow.calculatedAt,
      accounts: flow.coverage,
      comparisonGaps: compared ? flow.comparisonCoverage.gaps : [],
    });
    // A screen shows the comparison's own amounts when it is whole months. Otherwise the
    // current period's screen shows how far they moved.
    const previousMonths = wholeMonths(flow.comparison);
    const overviewOf = (period: MonthsSelection) =>
      ({ kind: "overview", period, comparison: { kind: "previous" } }) satisfies RecordLink;
    const overview = { kind: "overview", ...params } satisfies RecordLink;
    const spendingOn = (scope: Scope) => ({
      current: { kind: "spending", ...params, ...scope } satisfies RecordLink,
      previous: {
        kind: "spending",
        ...params,
        ...scope,
        period: previousMonths ?? params.period,
      } satisfies RecordLink,
    });
    yield* evidence.step({ label: `Reading money in and out for ${label}`, records: overview });
    yield* evidence.names([
      ...[...flow.inflows, ...flow.outflows].map((stream) => stream.label),
      ...flow.changes.flatMap((change) => [change.label, change.parentLabel]),
    ]);

    const against = Effect.fnUntraced(function* (
      subject: string,
      current: Money,
      previous: Money,
      records: { readonly current: RecordLink; readonly previous: RecordLink },
    ) {
      if (!compared) return null;
      return {
        amount: yield* cite(read, `${subject}, ${since}`, money(previous), records.previous),
        change: yield* cite(
          read,
          `${subject}, ${changed}`,
          change(compareMoney(current, previous).change),
          records.current,
        ),
      };
    });
    // Spending shows a spending scope's percent change too.
    const percentAgainst = (
      subject: string,
      current: Money,
      previous: Money,
      records: RecordLink,
    ) => {
      const ratio = compareMoney(current, previous).percentChange;
      return !compared || ratio === null
        ? Effect.succeed(null)
        : cite(read, `${subject}, percent ${changed}`, changePercent(ratio), records);
    };
    const total = Effect.fnUntraced(function* (subject: string, current: Money, previous: Money) {
      return {
        amount: yield* cite(read, `${subject}, ${label}`, money(current), overview),
        comparison: yield* against(subject, current, previous, {
          current: overview,
          previous: previousMonths ? overviewOf(previousMonths) : overview,
        }),
      };
    });
    const stream = (direction: FlowDirection) =>
      Effect.fnUntraced(function* (item: FlowStream) {
        const { measure, ...scope } = item.scope;
        const spending = measure === "spending" ? spendingOn(scope) : null;
        const records: RecordLink = spending
          ? spending.current
          : { kind: "countedLedger", scope: item.scope, period: params.period, filter: {} };
        const value = money(item.amount);
        const id = yield* register(
          read,
          `${item.label}, ${label}`,
          value,
          records,
          item.modelAmount,
        );
        yield* flagNotUnderstood(item.scope, item.amount, id);
        return {
          direction,
          label: item.label,
          scope: item.scope,
          amount: view(id, value),
          comparison: spending
            ? yield* against(item.label, item.amount, item.previous, spending)
            : null,
          percentChange: spending
            ? yield* percentAgainst(item.label, item.amount, item.previous, spending.current)
            : null,
        };
      });

    const { totals, previousTotals } = flow;
    const surplus = leftOver(totals);
    const allSpending = spendingOn({ category: { kind: "all" }, counterparty: { kind: "all" } });
    return {
      period: label,
      comparedWith: since,
      comparisonRecords: flow.comparisonCoverage.state,
      cameIn: yield* total("Came in", totals.inflow, previousTotals.inflow),
      wentOut: yield* total("Went out", totals.outflow, previousTotals.outflow),
      leftOver:
        surplus.minor >= 0n
          ? yield* cite(read, `Left over, ${label}`, money(surplus), overview)
          : null,
      shortBy:
        surplus.minor < 0n
          ? yield* cite(
              read,
              `Short by, ${label}`,
              money({ ...surplus, minor: -surplus.minor }),
              overview,
            )
          : null,
      betweenYourAccounts: yield* cite(
        read,
        `Money moved between your accounts, ${label}`,
        money(totals.internal),
        overview,
      ),
      spending: {
        amount: yield* cite(
          read,
          `Spending, ${label}`,
          money(totals.spending),
          allSpending.current,
          flow.modelShare,
        ),
        comparison: yield* against(
          "Spending",
          totals.spending,
          previousTotals.spending,
          allSpending,
        ),
        percentChange: yield* percentAgainst(
          "Spending",
          totals.spending,
          previousTotals.spending,
          allSpending.current,
        ),
      },
      income: yield* cite(read, `Income, ${label}`, money(totals.income), {
        kind: "countedLedger",
        scope: { measure: "income", category: { kind: "all" }, counterparty: { kind: "all" } },
        period: params.period,
        filter: {},
      }),
      streams: [
        ...(yield* Effect.forEach(flow.inflows, stream("in"))),
        ...(yield* Effect.forEach(flow.outflows, stream("out"))),
      ],
      largestChanges: yield* Effect.forEach(
        flow.changes,
        Effect.fnUntraced(function* (item) {
          return {
            label: item.label,
            parent: item.parentLabel,
            category: item.category,
            figures: yield* presentSpendingFigures(
              read,
              item.label,
              { period: label, comparison: compared ? since : null },
              item,
              item.category,
              spendingOn({ category: item.category, counterparty: { kind: "all" } }),
            ),
          };
        }),
      ),
    };
  });

export const ReadMonths = Tool.make("ReadMonths", {
  description:
    "What came in, went out, and was spent in every month with records, oldest first, and " +
    "whether each month's records are complete.",
  success: Schema.Struct({
    months: Schema.Array(
      Schema.Struct({
        month: Schema.String,
        // A month without records has no figures.
        records: CoverageState,
        cameIn: Schema.NullOr(FigureView),
        wentOut: Schema.NullOr(FigureView),
        spending: Schema.NullOr(FigureView),
      }),
    ),
  }),
  failure: FinanceError,
  failureMode: "return",
  dependencies: [TurnEvidence],
});

export const readMonths = (api: Pick<Api, "getMonthlyFlow" | "getCoverage">) =>
  Effect.fn("ReadMonths")(function* () {
    const evidence = yield* TurnEvidence;
    const months = yield* api.getMonthlyFlow({ currency: evidence.currency });
    yield* evidence.step({ label: "Reading money in and out by month", records: null });
    const byMonth = yield* monthReads(api, months);
    return {
      months: yield* Effect.forEach(
        months,
        Effect.fnUntraced(function* (month) {
          const placed = byMonth.get(month.month);
          const label = monthLabel(month.month);
          const period = { kind: "months", from: month.month, to: month.month } as const;
          const overview = {
            kind: "overview",
            period,
            comparison: { kind: "previous" },
          } satisfies RecordLink;
          const figure = (
            subject: string,
            amount: Money,
            records: RecordLink,
            modelAmount: Money | null = null,
          ) =>
            placed === undefined
              ? Effect.succeed(null)
              : cite(placedBy(placed), `${subject}, ${label}`, money(amount), records, modelAmount);
          return {
            month: label,
            records: month.coverage,
            cameIn: yield* figure("Came in", month.inflow, overview),
            wentOut: yield* figure("Went out", month.outflow, overview),
            spending: yield* figure(
              "Spending",
              month.spending,
              {
                kind: "spending",
                period,
                comparison: { kind: "previous" },
                category: { kind: "all" },
                counterparty: { kind: "all" },
              },
              month.modelShare,
            ),
          };
        }),
      ),
    };
  });

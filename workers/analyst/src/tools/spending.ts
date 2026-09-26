import type { FigureId, FigureValue, RecordLink } from "@repo/contracts/analyst";
import {
  type CategoryScope,
  type CountedScope,
  CoverageState,
  FinanceError,
  type Money,
  MonthsSelection,
  Scope,
  type SpendingFigures,
  SpendingInput,
  SpendingLevel,
} from "@repo/contracts/finance";
import { monthLabel, periodLabel, wholeMonths } from "@repo/finance";
import type { Api } from "@repo/infra/api";
import { Effect, Schema, Struct } from "effect";
import { Tool } from "effect/unstable/ai";

import {
  change,
  changePercent,
  cite,
  count,
  FigureView,
  money,
  placedBy,
  type ReadBasis,
  register,
  share,
  view,
} from "../evidence/present.ts";
import { TurnEvidence } from "../evidence/service.ts";
import { monthReads } from "./coverage.ts";

// Money whose meaning is not known yet, unresolved or without a category, leaves every
// total it sits in less certain, so an answer states it even when it cites another figure.
export const flagNotUnderstood = Effect.fnUntraced(function* (
  scope: Pick<CountedScope, "measure" | "category">,
  amount: Money,
  figureId: FigureId,
) {
  const unknown =
    scope.measure === "unresolvedIn" ||
    scope.measure === "unresolvedOut" ||
    scope.category.kind === "uncategorised";
  if (unknown && amount.minor !== 0n)
    yield* (yield* TurnEvidence).limit({ kind: "notUnderstood", figureId });
});

// Spending in one scope and period, with the comparison's figures when that period has
// records to compare with.
export const SpendingFiguresView = Schema.Struct({
  amount: FigureView,
  purchases: FigureView,
  // Spending from purchases over their number. Null without purchases.
  averagePurchase: Schema.NullOr(FigureView),
  comparison: Schema.NullOr(
    Schema.Struct({
      amount: FigureView,
      change: FigureView,
      // Null unless the comparison amount is positive.
      percentChange: Schema.NullOr(FigureView),
      purchases: FigureView,
      averagePurchase: Schema.NullOr(FigureView),
      // The change splits into these three. The first two are null unless both periods
      // have purchases.
      fromPurchaseCount: Schema.NullOr(FigureView),
      fromAveragePurchase: Schema.NullOr(FigureView),
      fromOtherSpending: FigureView,
    }),
  ),
});

// Labels each figure after `subject` and its period, such as "Dining out, August 2026". A
// null comparison label leaves the comparison out, because its period has no records.
// The comparison period's own figures open `records.previous`, where they show.
export const presentSpendingFigures = Effect.fnUntraced(function* (
  read: ReadBasis,
  subject: string,
  labels: { readonly period: string; readonly comparison: string | null },
  figures: typeof SpendingFigures.Type,
  category: CategoryScope,
  records: { readonly current: RecordLink; readonly previous: RecordLink },
) {
  const figure = (label: string, value: FigureValue, opens = records.current) =>
    cite(read, `${subject}, ${label}`, value, opens);
  const average = (amount: Money | null, label: string, opens = records.current) =>
    amount === null ? Effect.succeed(null) : figure(label, money(amount), opens);
  const amount = money(figures.current);
  const amountId = yield* register(
    read,
    `${subject}, ${labels.period}`,
    amount,
    records.current,
    figures.modelAmount,
  );
  yield* flagNotUnderstood({ measure: "spending", category }, figures.current, amountId);
  const current = {
    amount: view(amountId, amount),
    purchases: yield* figure(`purchases in ${labels.period}`, count(figures.purchases, "purchase")),
    averagePurchase: yield* average(
      figures.averagePurchase,
      `average purchase in ${labels.period}`,
    ),
  };
  if (labels.comparison === null) return { ...current, comparison: null };
  const changed = `change from ${labels.comparison} to ${labels.period}`;
  const part = (amount: Money | null, label: string) =>
    amount === null ? Effect.succeed(null) : figure(`${changed} ${label}`, change(amount));
  return {
    ...current,
    comparison: {
      amount: yield* figure(labels.comparison, money(figures.previous), records.previous),
      change: yield* figure(changed, change(figures.change)),
      percentChange:
        figures.percentChange === null
          ? null
          : yield* figure(`percent ${changed}`, changePercent(figures.percentChange)),
      purchases: yield* figure(
        `purchases in ${labels.comparison}`,
        count(figures.previousPurchases, "purchase"),
        records.previous,
      ),
      averagePurchase: yield* average(
        figures.previousAveragePurchase,
        `average purchase in ${labels.comparison}`,
        records.previous,
      ),
      fromPurchaseCount: yield* part(figures.purchasesPart, "from the number of purchases"),
      fromAveragePurchase: yield* part(figures.averagePart, "from the average purchase"),
      fromOtherSpending: yield* figure(
        `${changed} from spending that is not a purchase`,
        change(figures.otherPart),
      ),
    },
  };
});

// How Spending names the tag and personal event it is narrowed to, as "tagged Work" and
// "for Japan trip".
const narrowingOf = Effect.fnUntraced(function* (
  api: Pick<Api, "getReferenceData">,
  { tagId, personalEventId }: Pick<SpendingInput, "tagId" | "personalEventId">,
) {
  if (tagId === undefined && personalEventId === undefined) return [];
  const reference = yield* api.getReferenceData();
  const tag = reference.tags.find((item) => item.id === tagId);
  const event = reference.personalEvents.find((item) => item.id === personalEventId);
  yield* (yield* TurnEvidence).names([tag?.name ?? null, event?.name ?? null]);
  return [
    tagId === undefined ? [] : [`tagged ${tag?.name ?? "with a removed tag"}`],
    personalEventId === undefined ? [] : [`for ${event?.name ?? "a removed personal event"}`],
  ].flat();
});

export const ReadSpending = Tool.make("ReadSpending", {
  description:
    "Spending in a span of whole months against a comparison, for all spending or one scope. " +
    "A category scope reads a category with its subcategories (category), only what sits on " +
    "the category itself (unspecified), or spending with no category (uncategorised). A " +
    "counterparty scope narrows it to one counterparty or to spending with none " +
    "(unidentified). A tag or personal event narrows it to the spending that carries it. " +
    "Returns the scope's figures, its own twelve months, and a row for each part of the " +
    "scope one level down; read a row with its `opens` scope.",
  parameters: Schema.Struct({
    period: MonthsSelection,
    ...Struct.omit(SpendingInput.fields, ["period", "basis", "currency"]),
  }),
  success: Schema.Struct({
    // The categories, then the counterparty, tag, and personal event that narrow spending
    // to the scope, as Spending names them. Empty for all spending.
    scope: Schema.Array(Schema.String),
    period: Schema.String,
    comparedWith: Schema.String,
    comparisonRecords: CoverageState,
    // What the rows are: the scope's categories one level down, its counterparties, or,
    // for one counterparty, none. List a counterparty's transactions with ListTransactions.
    level: SpendingLevel,
    figures: SpendingFiguresView,
    // The twelve months that end with the period's last month. A month without records
    // has no amount.
    months: Schema.Array(
      Schema.Struct({
        month: Schema.String,
        records: CoverageState,
        amount: Schema.NullOr(FigureView),
      }),
    ),
    rows: Schema.Array(
      Schema.Struct({
        label: Schema.String,
        opens: Scope,
        // The row's part of what the rows with positive spending add up to. Null when its
        // own spending is not positive.
        share: Schema.NullOr(FigureView),
        figures: SpendingFiguresView,
      }),
    ),
  }),
  failure: FinanceError,
  failureMode: "return",
  dependencies: [TurnEvidence],
});

export const readSpending = (api: Pick<Api, "getSpending" | "getCoverage" | "getReferenceData">) =>
  Effect.fn("ReadSpending")(function* (params: Tool.Parameters<typeof ReadSpending>) {
    const evidence = yield* TurnEvidence;
    const [breakdown, narrowing] = yield* Effect.all(
      [
        api.getSpending({ ...params, basis: "spending", currency: evidence.currency }),
        narrowingOf(api, params),
      ],
      { concurrency: "unbounded" },
    );
    const { period, comparison, comparisonCoverage } = breakdown;
    const compared = comparisonCoverage.state !== "missing";
    const labels = {
      period: periodLabel(period),
      comparison: compared ? periodLabel(comparison) : null,
    };
    const read = placedBy({
      period,
      comparison: compared ? comparison : null,
      basis: breakdown.basis,
      calculatedAt: breakdown.calculatedAt,
      accounts: breakdown.coverage,
      comparisonGaps: compared ? comparisonCoverage.gaps : [],
    });
    const link = (scope: Scope, months: MonthsSelection = params.period) =>
      ({ kind: "spending", ...params, ...scope, period: months }) satisfies RecordLink;
    // Spending shows the comparison's own figures when it is whole months.
    const links = (scope: Scope) => ({
      current: link(scope),
      previous: link(scope, wholeMonths(comparison) ?? params.period),
    });
    const path = breakdown.path.map((crumb) => crumb.label);
    const opened = path.at(-1);
    // A row is narrowed like the scope it sits in.
    const narrowed = (label: string) => [label, ...narrowing].join(" ");
    const subject = narrowed(opened ?? "Spending");
    const within = [...(opened === undefined ? [] : [`in ${opened}`]), ...narrowing];
    yield* evidence.step({
      label: ["Reading spending", ...within, `for ${labels.period}`].join(" "),
      records: link(breakdown.scope),
    });
    yield* evidence.names([...path, ...breakdown.rows.map((row) => row.label)]);
    const byMonth = yield* monthReads(api, breakdown.months);
    return {
      scope: [...path, ...narrowing],
      period: labels.period,
      comparedWith: periodLabel(comparison),
      comparisonRecords: comparisonCoverage.state,
      level: breakdown.level,
      figures: yield* presentSpendingFigures(
        read,
        subject,
        labels,
        breakdown.figures,
        breakdown.scope.category,
        links(breakdown.scope),
      ),
      months: yield* Effect.forEach(
        breakdown.months,
        Effect.fnUntraced(function* (month) {
          const placed = byMonth.get(month.month);
          const label = monthLabel(month.month);
          return {
            month: label,
            records: month.coverage,
            amount:
              placed === undefined
                ? null
                : yield* cite(
                    placedBy(placed),
                    `${subject}, ${label}`,
                    money(month.amount),
                    link(breakdown.scope, { kind: "months", from: month.month, to: month.month }),
                    month.modelAmount,
                  ),
          };
        }),
      ),
      rows: yield* Effect.forEach(
        breakdown.rows,
        Effect.fnUntraced(function* (row) {
          return {
            label: row.label,
            opens: row.opens,
            share:
              row.share === null
                ? null
                : yield* cite(
                    read,
                    `${narrowed(row.label)}, share of ${subject} in ${labels.period}`,
                    share(row.share),
                    link(breakdown.scope),
                  ),
            figures: yield* presentSpendingFigures(
              read,
              narrowed(row.label),
              labels,
              row.figures,
              row.opens.category,
              links(row.opens),
            ),
          };
        }),
      ),
    };
  });

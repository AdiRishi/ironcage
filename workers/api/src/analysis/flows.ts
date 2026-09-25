import { PgClient } from "@effect/sql-pg";
import {
  CategoryId,
  FactMeasure,
  FinanceError,
  FlowInput,
  MonthlyFlow,
  MonthlyFlowInput,
  PeriodFlow,
  YearMonth,
  type Period,
} from "@repo/contracts/finance";
import {
  accountCoverage,
  comparisonCoverage,
  largestChanges,
  monthCoverage,
  shiftYearMonth,
  summarizeFlow,
  yearMonthOf,
  type FlowRow,
} from "@repo/finance";
import { Context, Effect, Layer, Schema } from "effect";

import { toFinanceError } from "../database/failures.ts";
import { readTransaction } from "../database/transactions.ts";
import { categoryNodes } from "./categories.ts";
import { coverageSources } from "./coverage.ts";
import { factsIn, onLoanAccount, periodSums, PeriodSums } from "./fact-sql.ts";
import { readToday, resolvePeriods } from "./periods.ts";

const Row = Schema.Struct({
  measure: FactMeasure,
  categoryId: Schema.NullOr(CategoryId),
  loanAccount: Schema.Boolean,
  ...PeriodSums.fields,
});

type PeriodQuery = {
  currency: string;
  basis: FlowInput["basis"];
  period: Period;
  comparison: Period;
};

// Sums facts for both periods in one pass, grouped by measure, category, and whether
// they sit on a loan account.
const factRows = Effect.fn("factRows")(function* ({
  currency,
  basis,
  period,
  comparison,
}: PeriodQuery) {
  const sql = yield* PgClient.PgClient;
  const current = factsIn(sql, basis, period);
  const previous = factsIn(sql, basis, comparison);
  return yield* sql`SELECT f.measure, f.category_id AS "categoryId", ${onLoanAccount(sql)} AS "loanAccount",
      ${periodSums(sql, current, previous)}
    FROM ledger_facts f
    WHERE f.currency = ${currency} AND ((${current}) OR (${previous}))
    GROUP BY 1, 2, 3`.pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Row))));
});

// The flow of one period from stored facts. Previews run it before and after writing
// a change's facts, so a preview and the screens can never disagree.
export const summarizePeriod = Effect.fn("summarizePeriod")(function* (query: PeriodQuery) {
  const [rows, categories] = yield* Effect.all([factRows(query), categoryNodes]);
  return summarizeFlow({ rows, categories, currency: query.currency });
});

export class Flows extends Context.Service<
  Flows,
  {
    readonly period: (input: FlowInput) => Effect.Effect<PeriodFlow, FinanceError>;
    readonly monthly: (
      input: typeof MonthlyFlowInput.Type,
    ) => Effect.Effect<typeof MonthlyFlow.Type, FinanceError>;
  }
>()("@repo/api/analysis/Flows") {
  static readonly layer = Layer.effect(
    Flows,
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      const provide = Effect.provideService(PgClient.PgClient, sql);
      const period = Effect.fn("Flows.period")(
        (input: FlowInput) =>
          readTransaction(
            sql,
            Effect.gen(function* () {
              const resolved = yield* resolvePeriods(input);
              const query = { ...input, ...resolved };
              const [facts, tree, sources] = yield* Effect.all([
                factRows(query),
                categoryNodes,
                coverageSources(input.currency),
              ]);
              const coverage = accountCoverage(sources, resolved.period);
              return {
                ...resolved,
                basis: input.basis,
                currency: input.currency,
                ...summarizeFlow({ rows: facts, categories: tree, currency: input.currency }),
                changes: largestChanges({
                  rows: facts,
                  categories: tree,
                  currency: input.currency,
                  limit: 6,
                }),
                coverage,
                comparisonCoverage: comparisonCoverage(
                  coverage,
                  resolved.period,
                  resolved.comparison,
                ),
              } satisfies PeriodFlow;
            }),
          ),
        provide,
        toFinanceError,
      );

      const monthly = Effect.fn("Flows.monthly")(
        ({ currency }: typeof MonthlyFlowInput.Type) =>
          readTransaction(
            sql,
            Effect.gen(function* () {
              const { today } = yield* readToday;
              const Month = Schema.Struct({
                month: YearMonth,
                measure: FactMeasure,
                loanAccount: Schema.Boolean,
                amount: Schema.BigIntFromString,
              });
              const totals =
                yield* sql`SELECT to_char(f.spending_on, 'YYYY-MM') AS month, f.measure, ${onLoanAccount(sql)} AS "loanAccount",
                  sum(f.amount_minor)::text AS amount
                FROM ledger_facts f
                WHERE f.currency = ${currency} GROUP BY 1, 2, 3 ORDER BY 1`.pipe(
                  Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Month))),
                );
              const first = totals[0]?.month;
              if (!first) return [];
              const sources = yield* coverageSources(currency);
              const tree = yield* categoryNodes;
              const months: YearMonth[] = [];
              const current = yearMonthOf(today);
              for (let month = first; month <= current; month = shiftYearMonth(month, 1))
                months.push(month);
              return months.map((month) => {
                const selected = totals.filter((row) => row.month === month);
                const flow = summarizeFlow({
                  currency,
                  categories: tree,
                  rows: selected.map((row): FlowRow => ({
                    measure: row.measure,
                    categoryId: null,
                    loanAccount: row.loanAccount,
                    current: row.amount,
                    previous: 0n,
                    modelCurrent: 0n,
                    purchaseCurrent: 0n,
                    purchasePrevious: 0n,
                    purchases: 0,
                    previousPurchases: 0,
                  })),
                });
                return {
                  month,
                  inflow: flow.totals.inflow,
                  outflow: flow.totals.outflow,
                  spending: flow.totals.spending,
                  coverage: monthCoverage(sources, month),
                };
              });
            }),
          ),
        provide,
        toFinanceError,
      );

      return Flows.of({ period, monthly });
    }),
  );
}

import { PgClient } from "@effect/sql-pg";
import {
  Account,
  AccountId,
  CalendarDate,
  CategoryId,
  CategoryTree,
  CounterpartyId,
  FinanceError,
  FlowInput,
  Instant,
  MonthlyFlow,
  MonthlyFlowInput,
  PeriodFlow,
  SpendingBreakdown,
  SpendingInput,
  YearMonth,
  type Period,
} from "@repo/contracts/finance";
import {
  accountCoverage,
  addDays,
  comparisonCoverage,
  largestChanges,
  mergePeriods,
  monthsPeriod,
  overlaps,
  shiftYearMonth,
  summarizeFlow,
  trailingYear,
  yearMonthOf,
  type CategoryNode,
  type FlowRow,
} from "@repo/finance";
import { Context, Effect, Layer, Schema } from "effect";

import { accountFields, instant } from "../database/columns.ts";
import { toFinanceError } from "../database/failures.ts";
import { readTransaction } from "../database/transactions.ts";
import { readToday, resolvePeriods } from "./periods.ts";

const Measure = Schema.Literals([
  "spending",
  "income",
  "internal",
  "externalOut",
  "externalIn",
  "loanRepayment",
  "borrowing",
  "unresolvedOut",
  "unresolvedIn",
]);
const Row = Schema.Struct({
  measure: Measure,
  categoryId: Schema.NullOr(CategoryId),
  topCategoryId: Schema.NullOr(CategoryId),
  current: Schema.BigIntFromString,
  previous: Schema.BigIntFromString,
  modelCurrent: Schema.BigIntFromString,
  purchases: Schema.Int,
  previousPurchases: Schema.Int,
});
const Category = Schema.Struct({
  id: CategoryId,
  parentId: Schema.NullOr(CategoryId),
  name: Schema.String,
  slug: Schema.NullOr(Schema.String),
  tree: CategoryTree,
  position: Schema.Int,
});
const Coverage = Schema.Struct({
  accountId: AccountId,
  observedStart: Schema.NullOr(CalendarDate),
  observedEnd: Schema.NullOr(CalendarDate),
  openingOn: Schema.NullOr(CalendarDate),
  closingOn: Schema.NullOr(CalendarDate),
  reconciled: Schema.Boolean,
});

const categoryNodes = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;
  return yield* sql`SELECT id, parent_id AS "parentId", name, slug, tree, position FROM categories ORDER BY tree DESC, position, name`.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Category))),
  );
});

type PeriodQuery = {
  currency: string;
  basis: FlowInput["basis"];
  period: Period;
  comparison: Period;
};

// Sums facts for both periods in one pass, grouped by measure and category.
const factRows = Effect.fn("factRows")(function* ({
  currency,
  basis,
  period,
  comparison,
}: PeriodQuery) {
  const sql = yield* PgClient.PgClient;
  const on = basis === "spending" ? sql`f.spending_on` : sql`f.posted_on`;
  const current = sql`${on} >= ${period.start}::date AND ${on} < ${period.endExclusive}::date`;
  const previous = sql`${on} >= ${comparison.start}::date AND ${on} < ${comparison.endExclusive}::date`;
  return yield* sql`SELECT f.measure, f.category_id AS "categoryId", f.top_category_id AS "topCategoryId",
      COALESCE(sum(f.amount_minor) FILTER (WHERE ${current}), 0)::text AS current,
      COALESCE(sum(f.amount_minor) FILTER (WHERE ${previous}), 0)::text AS previous,
      COALESCE(sum(f.amount_minor) FILTER (WHERE ${current} AND f.model_assigned), 0)::text AS "modelCurrent",
      count(DISTINCT f.event_id) FILTER (WHERE ${current} AND f.purchase AND f.amount_minor > 0)::int AS purchases,
      count(DISTINCT f.event_id) FILTER (WHERE ${previous} AND f.purchase AND f.amount_minor > 0)::int AS "previousPurchases"
    FROM ledger_facts f
    WHERE f.currency = ${currency} AND ((${current}) OR (${previous}))
    GROUP BY f.measure, f.category_id, f.top_category_id`.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Row))),
  );
});

const loanCostTotals = Effect.fn("loanCostTotals")(function* ({
  currency,
  basis,
  period,
  comparison,
}: PeriodQuery) {
  const sql = yield* PgClient.PgClient;
  const on = basis === "spending" ? sql`f.spending_on` : sql`f.posted_on`;
  const [row] =
    yield* sql`SELECT COALESCE(sum(f.amount_minor) FILTER (WHERE ${on} >= ${period.start}::date AND ${on} < ${period.endExclusive}::date), 0)::text AS current,
        COALESCE(sum(f.amount_minor) FILTER (WHERE ${on} >= ${comparison.start}::date AND ${on} < ${comparison.endExclusive}::date), 0)::text AS previous
      FROM ledger_facts f JOIN accounts a ON a.id = f.account_id
      WHERE a.kind = 'loan' AND f.measure = 'spending' AND f.currency = ${currency}`.pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(
          Schema.Tuple([
            Schema.Struct({ current: Schema.BigIntFromString, previous: Schema.BigIntFromString }),
          ]),
        ),
      ),
    );
  return row;
});

// The flow of one period from stored facts. Previews run it before and after writing
// a change's facts, so a preview and the screens can never disagree.
export const summarizePeriod = Effect.fn("summarizePeriod")(function* (query: PeriodQuery) {
  const [rows, categories, loanCosts] = yield* Effect.all([
    factRows(query),
    categoryNodes,
    loanCostTotals(query),
  ]);
  return summarizeFlow({ rows, categories, loanCosts, currency: query.currency });
});

export class Flows extends Context.Service<
  Flows,
  {
    readonly period: (input: FlowInput) => Effect.Effect<PeriodFlow, FinanceError>;
    readonly monthly: (
      input: typeof MonthlyFlowInput.Type,
    ) => Effect.Effect<typeof MonthlyFlow.Type, FinanceError>;
    readonly spending: (input: SpendingInput) => Effect.Effect<SpendingBreakdown, FinanceError>;
  }
>()("@repo/api/analysis/Flows") {
  static readonly layer = Layer.effect(
    Flows,
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      const provide = Effect.provideService(PgClient.PgClient, sql);
      const dateColumn = (basis: FlowInput["basis"]) =>
        basis === "spending" ? sql`f.spending_on` : sql`f.posted_on`;
      const coverageSources = Effect.fn("Flows.coverageSources")(function* (currency: string) {
        const accounts =
          yield* sql`SELECT ${accountFields(sql)} FROM accounts WHERE currency = ${currency} ORDER BY label, id`.pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Account))),
          );
        const sources =
          yield* sql`SELECT account_id AS "accountId", observed_start::text AS "observedStart", observed_end::text AS "observedEnd",
              opening_on::text AS "openingOn", closing_on::text AS "closingOn",
              (reconciled AND opening_minor IS NOT NULL AND closing_minor IS NOT NULL) AS reconciled
            FROM source_coverage c JOIN accounts a ON a.id = c.account_id WHERE a.currency = ${currency}`.pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Coverage))),
          );
        const imports =
          yield* sql`SELECT account_id AS "accountId", ${instant(sql, sql`max(created_at)`)} AS at FROM imports
            WHERE status IN ('complete', 'needs_review') AND account_id IS NOT NULL GROUP BY account_id`.pipe(
            Effect.flatMap(
              Schema.decodeUnknownEffect(
                Schema.Array(Schema.Struct({ accountId: AccountId, at: Instant })),
              ),
            ),
          );
        return { accounts, sources, imports };
      });

      const period = Effect.fn("Flows.period")(
        (input: FlowInput) =>
          readTransaction(
            sql,
            Effect.gen(function* () {
              const resolved = yield* resolvePeriods(input);
              const query = { ...input, ...resolved };
              const [facts, tree, costs, sources] = yield* Effect.all([
                factRows(query),
                categoryNodes,
                loanCostTotals(query),
                coverageSources(input.currency),
              ]);
              const coverage = accountCoverage(sources, resolved.period);
              return {
                ...resolved,
                basis: input.basis,
                currency: input.currency,
                ...summarizeFlow({
                  rows: facts,
                  categories: tree,
                  loanCosts: costs,
                  currency: input.currency,
                }),
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
                measure: Measure,
                amount: Schema.BigIntFromString,
                loanCosts: Schema.BigIntFromString,
              });
              const totals =
                yield* sql`SELECT to_char(f.spending_on, 'YYYY-MM') AS month, f.measure, sum(f.amount_minor)::text AS amount,
                  COALESCE(sum(f.amount_minor) FILTER (WHERE a.kind = 'loan' AND f.measure = 'spending'), 0)::text AS "loanCosts"
                FROM ledger_facts f JOIN accounts a ON a.id = f.account_id
                WHERE f.currency = ${currency} GROUP BY 1, 2 ORDER BY 1`.pipe(
                  Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Month))),
                );
              const first = totals[0]?.month;
              if (!first) return [];
              const sources = yield* coverageSources(currency);
              const tree = yield* categoryNodes;
              const spans = new Map<string, Period>();
              for (const account of sources.accounts) {
                const observed = mergePeriods(
                  sources.sources.flatMap((source) =>
                    source.accountId === account.id && source.observedStart && source.observedEnd
                      ? [
                          {
                            start: source.observedStart,
                            endExclusive: addDays(source.observedEnd, 1),
                          },
                        ]
                      : [],
                  ),
                );
                const [first] = observed;
                const last = observed.at(-1);
                if (first && last)
                  spans.set(account.id, { start: first.start, endExclusive: last.endExclusive });
              }
              const months: YearMonth[] = [];
              const current = yearMonthOf(today);
              for (let month = first; month <= current; month = shiftYearMonth(month, 1))
                months.push(month);
              return months.map((month) => {
                const period = monthsPeriod(month);
                const selected = totals.filter((row) => row.month === month);
                const flow = summarizeFlow({
                  currency,
                  categories: tree,
                  loanCosts: {
                    current: selected.reduce((sum, row) => sum + row.loanCosts, 0n),
                    previous: 0n,
                  },
                  rows: selected.map((row): FlowRow => ({
                    measure: row.measure,
                    categoryId: null,
                    topCategoryId: null,
                    current: row.amount,
                    previous: 0n,
                    modelCurrent: 0n,
                    purchases: 0,
                    previousPurchases: 0,
                  })),
                });
                // An account counts for a month when its records span it at all.
                const coverage = accountCoverage(sources, period).filter((item) => {
                  const span = spans.get(item.account.id);
                  return span && overlaps(span, period);
                });
                const complete =
                  coverage.length > 0 && coverage.every((item) => item.missing.length === 0);
                const observed = coverage.some((item) =>
                  item.observed.some((interval) => overlaps(interval, period)),
                );
                return {
                  month,
                  inflow: flow.totals.inflow,
                  outflow: flow.totals.outflow,
                  spending: flow.totals.spending,
                  coverage: complete ? "complete" : observed ? "partial" : "missing",
                } as const;
              });
            }),
          ),
        provide,
        toFinanceError,
      );

      const spending = Effect.fn("Flows.spending")(
        (input: SpendingInput) =>
          readTransaction(
            sql,
            Effect.gen(function* () {
              const resolved = yield* resolvePeriods(input);
              const tree = yield* categoryNodes;
              const node = (id: string | null) => tree.find((row) => row.id === id);
              const path: CategoryNode[] = [];
              for (let at = node(input.categoryId); at; at = node(at.parentId)) path.unshift(at);
              if (input.categoryId && path.length === 0)
                return yield* new FinanceError({
                  kind: "notFound",
                  message: "Category not found.",
                });
              // Which row a category rolls up to at this level of the tree.
              const parentId = input.categoryId;
              const rowKey = (categoryId: string | null) => {
                let at = node(categoryId);
                while (at && at.parentId !== parentId) at = node(at.parentId);
                return at?.id ?? (parentId && categoryId === parentId ? parentId : null);
              };
              const inScope = (categoryId: string | null) => {
                if (!parentId) return true;
                for (let at = node(categoryId); at; at = node(at.parentId))
                  if (at.id === parentId) return true;
                return false;
              };
              const facts = (yield* factRows({ ...input, ...resolved })).filter(
                (row) => row.measure === "spending" && inScope(row.categoryId),
              );
              const series = yield* Effect.fromResult(trailingYear(resolved.period));
              const months = Array.from({ length: 12 }, (_, index) =>
                shiftYearMonth(yearMonthOf(series.start), index),
              );
              const on = dateColumn(input.basis);
              const MonthRow = Schema.Struct({
                categoryId: Schema.NullOr(CategoryId),
                month: YearMonth,
                amount: Schema.BigIntFromString,
              });
              const monthly =
                yield* sql`SELECT f.category_id AS "categoryId", to_char(${on}, 'YYYY-MM') AS month, sum(f.amount_minor)::text AS amount
                FROM ledger_facts f WHERE f.currency = ${input.currency} AND f.measure = 'spending'
                  AND ${on} >= ${series.start}::date AND ${on} < ${series.endExclusive}::date
                GROUP BY 1, 2`.pipe(
                  Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(MonthRow))),
                );
              const money = (minor: bigint) => ({ currency: input.currency, minor });
              const groups = new Map<string | null, typeof facts>();
              for (const row of facts) {
                const key = rowKey(row.categoryId);
                groups.set(key, [...(groups.get(key) ?? []), row]);
              }
              const total = (selected: typeof facts, pick: (row: FlowRow) => bigint) =>
                selected.reduce((sum, row) => sum + pick(row), 0n);
              const breakdownRows = [...groups.entries()]
                .map(([key, selected]) => {
                  const category = node(key);
                  return {
                    categoryId: category?.id ?? null,
                    slug: category?.slug ?? null,
                    label: !category
                      ? "Not yet categorised"
                      : category.id === parentId
                        ? `${category.name}, unspecified`
                        : category.name,
                    current: money(total(selected, (row) => row.current)),
                    previous: money(total(selected, (row) => row.previous)),
                    purchases: selected.reduce((sum, row) => sum + row.purchases, 0),
                    previousPurchases: selected.reduce(
                      (sum, row) => sum + row.previousPurchases,
                      0,
                    ),
                    modelAmount: money(total(selected, (row) => row.modelCurrent)),
                    months: months.map((month) =>
                      money(
                        monthly
                          .filter(
                            (row) =>
                              row.month === month &&
                              inScope(row.categoryId) &&
                              rowKey(row.categoryId) === key,
                          )
                          .reduce((sum, row) => sum + row.amount, 0n),
                      ),
                    ),
                  };
                })
                .filter((row) => row.current.minor !== 0n || row.previous.minor !== 0n)
                .toSorted((a, b) =>
                  b.current.minor > a.current.minor
                    ? 1
                    : b.current.minor < a.current.minor
                      ? -1
                      : 0,
                );
              const scope = parentId
                ? sql`f.category_id = ANY(${tree.filter((row) => inScope(row.id)).map((row) => row.id)}::uuid[])`
                : sql`true`;
              const current = sql`${on} >= ${resolved.period.start}::date AND ${on} < ${resolved.period.endExclusive}::date`;
              const previous = sql`${on} >= ${resolved.comparison.start}::date AND ${on} < ${resolved.comparison.endExclusive}::date`;
              const Counterparty = Schema.Struct({
                counterpartyId: Schema.NullOr(CounterpartyId),
                label: Schema.NullOr(Schema.String),
                current: Schema.BigIntFromString,
                previous: Schema.BigIntFromString,
                purchases: Schema.Int,
                previousPurchases: Schema.Int,
              });
              const counterparties =
                yield* sql`SELECT f.counterparty_id AS "counterpartyId", c.name AS label,
                  COALESCE(sum(f.amount_minor) FILTER (WHERE ${current}), 0)::text AS current,
                  COALESCE(sum(f.amount_minor) FILTER (WHERE ${previous}), 0)::text AS previous,
                  count(DISTINCT f.event_id) FILTER (WHERE ${current} AND f.purchase AND f.amount_minor > 0)::int AS purchases,
                  count(DISTINCT f.event_id) FILTER (WHERE ${previous} AND f.purchase AND f.amount_minor > 0)::int AS "previousPurchases"
                FROM ledger_facts f LEFT JOIN counterparties c ON c.id = f.counterparty_id
                WHERE f.currency = ${input.currency} AND f.measure = 'spending' AND ${scope} AND ((${current}) OR (${previous}))
                GROUP BY f.counterparty_id, c.name
                ORDER BY COALESCE(sum(f.amount_minor) FILTER (WHERE ${current}), 0) DESC LIMIT 25`.pipe(
                  Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Counterparty))),
                );
              const sources = yield* coverageSources(input.currency);
              return {
                ...resolved,
                basis: input.basis,
                currency: input.currency,
                path: path.map((row) => ({ id: row.id, label: row.name, slug: row.slug })),
                total: money(total(facts, (row) => row.current)),
                previousTotal: money(total(facts, (row) => row.previous)),
                modelAmount: money(total(facts, (row) => row.modelCurrent)),
                months,
                rows: breakdownRows,
                counterparties: counterparties.map((row) => ({
                  counterpartyId: row.counterpartyId,
                  label: row.label ?? "Unidentified",
                  current: money(row.current),
                  previous: money(row.previous),
                  purchases: row.purchases,
                  previousPurchases: row.previousPurchases,
                })),
                comparisonCoverage: comparisonCoverage(
                  accountCoverage(sources, resolved.period),
                  resolved.period,
                  resolved.comparison,
                ),
              } satisfies SpendingBreakdown;
            }),
          ),
        provide,
        toFinanceError,
      );

      return Flows.of({ period, monthly, spending });
    }),
  );
}

import { PgClient } from "@effect/sql-pg";
import {
  type CategoryId,
  type CategoryScope,
  CounterpartyId,
  type FinanceError,
  type Scope,
  type SpendingBreakdown,
  type SpendingInput,
  type SpendingLevel,
  type SpendingRow,
  YearMonth,
} from "@repo/contracts/finance";
import {
  accountCoverage,
  categoryPath,
  changeFigures,
  comparisonCoverage,
  hasChildren,
  monthCoverage,
  rollupKeys,
  shares,
  shiftYearMonth,
  trailingYear,
  uncategorisedLabel,
  unidentifiedLabel,
  unspecifiedLabel,
  yearMonthOf,
  type CategoryNode,
} from "@repo/finance";
import { Array as Arr, Context, Effect, Layer, Order, Schema } from "effect";

import { toFinanceError } from "../database/failures.ts";
import { readTransaction } from "../database/transactions.ts";
import { allocationPredicates } from "../postings/ledger-rows.ts";
import { categoryNodes } from "./categories.ts";
import { coverageSources } from "./coverage.ts";
import {
  categoryFacts,
  counterpartyFacts,
  factDate,
  factsIn,
  periodSums,
  PeriodSums,
} from "./fact-sql.ts";
import { resolvePeriods } from "./periods.ts";
import { scopePath } from "./scopes.ts";

const Sums = Schema.Struct({ key: Schema.NullOr(Schema.String), ...PeriodSums.fields });
const MonthSum = Schema.Struct({
  month: YearMonth,
  key: Schema.NullOr(Schema.String),
  ofScope: Schema.Boolean,
  amount: Schema.BigIntFromString,
});
const Named = Schema.Struct({ id: CounterpartyId, name: Schema.String });

const allCounterparties = { kind: "all" } as const;
const largestFirst = Order.combineAll<SpendingRow>([
  Order.mapInput(Order.flip(Order.BigInt), (row) => row.figures.current.minor),
  Order.mapInput(Order.flip(Order.BigInt), (row) => row.figures.previous.minor),
  Order.mapInput(Order.String, (row) => row.label),
]);

// A scope opens the categories one level below it while there are any, then its
// counterparties, then one counterparty's records.
function levelOf(
  nodes: readonly CategoryNode[],
  { category, counterparty }: Scope,
): typeof SpendingLevel.Type {
  if (counterparty.kind !== "all") return "transactions";
  if (category.kind === "all") return "categories";
  if (category.kind === "category" && hasChildren(nodes, category.id)) return "categories";
  return "counterparties";
}

// The category whose subcategories the category rows are, and null when they are the
// top-level categories.
const openCategory = (category: CategoryScope) =>
  category.kind === "category" ? category.id : null;

// The slug that colours a category: its own, or the nearest one above it. A scope takes
// its category's.
const slugOf = (nodes: readonly CategoryNode[], id: typeof CategoryId.Type) =>
  categoryPath(nodes, id).findLast((node) => node.slug !== null)?.slug ?? null;
const scopeSlug = (nodes: readonly CategoryNode[], category: CategoryScope) =>
  category.kind === "category" || category.kind === "unspecified"
    ? slugOf(nodes, category.id)
    : null;

// What a level's row is called, how it is coloured, and the scope it opens, by its key.
// The transactions level has no rows.
const rowDescriptions = Effect.fn("rowDescriptions")(function* (
  level: typeof SpendingLevel.Type,
  nodes: readonly CategoryNode[],
  category: CategoryScope,
  keys: readonly (string | null)[],
) {
  const sql = yield* PgClient.PgClient;
  type Described = Pick<SpendingRow, "label" | "slug" | "opens">;
  switch (level) {
    case "categories": {
      const open = openCategory(category);
      return (key: string | null): Described => {
        const node = nodes.find((item) => item.id === key);
        if (!node)
          return {
            label: uncategorisedLabel,
            slug: null,
            opens: { category: { kind: "uncategorised" }, counterparty: allCounterparties },
          };
        return {
          label: node.id === open ? unspecifiedLabel(node.name) : node.name,
          slug: slugOf(nodes, node.id),
          opens: {
            category: { kind: node.id === open ? "unspecified" : "category", id: node.id },
            counterparty: allCounterparties,
          },
        };
      };
    }
    case "counterparties": {
      const named = yield* sql`SELECT id, name FROM counterparties WHERE ${sql.in(
        "id",
        keys.filter((key) => key !== null),
      )}`.pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Named))));
      const slug = scopeSlug(nodes, category);
      return (key: string | null): Described => {
        const counterparty = named.find((row) => row.id === key);
        return {
          label: counterparty?.name ?? unidentifiedLabel,
          slug,
          opens: {
            category,
            counterparty: counterparty
              ? { kind: "counterparty", id: counterparty.id }
              : { kind: "unidentified" },
          },
        };
      };
    }
    case "transactions":
      return null;
  }
});

const breakdownOf = Effect.fn("spendingBreakdown")(function* (input: SpendingInput) {
  const sql = yield* PgClient.PgClient;
  const resolved = yield* resolvePeriods(input);
  const nodes = yield* categoryNodes;
  const scope = { category: input.category, counterparty: input.counterparty };
  const path = yield* scopePath(nodes, scope);
  const level = levelOf(nodes, scope);
  const trailing = yield* Effect.fromResult(trailingYear(resolved.period));
  const months = Array.from({ length: 12 }, (_, index) =>
    shiftYearMonth(yearMonthOf(trailing.start), index),
  );

  // A category row's key is the category its facts roll up to, and a counterparty row's
  // is their counterparty.
  const keys = rollupKeys(nodes, openCategory(input.category));
  const grouping =
    level === "categories"
      ? {
          key: sql`k.row_key`,
          join: sql`LEFT JOIN unnest(${[...keys.keys()]}::uuid[], ${[...keys.values()]}::uuid[]) AS k(category_id, row_key) ON k.category_id = f.category_id`,
        }
      : { key: sql`f.counterparty_id`, join: sql`` };
  const scoped = sql.and([
    sql`f.currency = ${input.currency}`,
    sql`f.measure = 'spending'`,
    categoryFacts(sql, input.category),
    counterpartyFacts(sql, input.counterparty),
    ...allocationPredicates(sql, sql`f.allocation_id`, input),
  ]);
  const current = factsIn(sql, input.basis, resolved.period);
  const previous = factsIn(sql, input.basis, resolved.comparison);
  // The empty grouping set sums the whole scope, so a purchase split across two rows
  // counts once in it.
  const [total, ...groups] =
    yield* sql`SELECT ${grouping.key} AS key, ${periodSums(sql, current, previous)}
      FROM ledger_facts f ${grouping.join}
      WHERE ${scoped} AND ((${current}) OR (${previous}))
      GROUP BY GROUPING SETS ((${grouping.key}), ())
      ORDER BY GROUPING(${grouping.key}) DESC`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.NonEmptyArray(Sums))),
    );
  const month = sql`to_char(${factDate(sql, input.basis)}, 'YYYY-MM')`;
  const monthly =
    yield* sql`SELECT ${month} AS month, ${grouping.key} AS key, GROUPING(${grouping.key}) = 1 AS "ofScope",
        sum(f.amount_minor)::text AS amount
      FROM ledger_facts f ${grouping.join}
      WHERE ${scoped} AND ${factsIn(sql, input.basis, trailing)}
      GROUP BY GROUPING SETS ((${month}, ${grouping.key}), (${month}))`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(MonthSum))),
    );
  const describe = yield* rowDescriptions(
    level,
    nodes,
    input.category,
    groups.map(({ key }) => key),
  );
  const sources = yield* coverageSources(input.currency);
  const coverage = accountCoverage(sources, resolved.period);

  const money = (minor: bigint) => ({ currency: input.currency, minor });
  const figuresOf = (sums: typeof Sums.Type) => ({
    ...changeFigures(sums, input.currency),
    modelAmount: money(sums.modelCurrent),
  });
  const seriesOf = (sums: readonly (typeof MonthSum.Type)[]) => {
    const byMonth = new Map(sums.map((row) => [row.month, row.amount]));
    return (at: YearMonth) => money(byMonth.get(at) ?? 0n);
  };
  const scopeSeries = seriesOf(monthly.filter((row) => row.ofScope));
  const rowMonths = Map.groupBy(
    monthly.filter((row) => !row.ofScope),
    (row) => row.key,
  );
  const listed = groups.filter((sums) => sums.current !== 0n || sums.previous !== 0n);
  return {
    ...resolved,
    basis: input.basis,
    currency: input.currency,
    scope,
    slug: scopeSlug(nodes, input.category),
    path,
    level,
    figures: figuresOf(total),
    months: months.map((at) => ({
      month: at,
      amount: scopeSeries(at),
      coverage: monthCoverage(sources, at),
    })),
    coverage,
    comparisonCoverage: comparisonCoverage(coverage, resolved.period, resolved.comparison),
    rows: describe
      ? Arr.zipWith(
          listed,
          shares(listed.map((sums) => sums.current)),
          (sums, share): SpendingRow => ({
            ...describe(sums.key),
            share,
            figures: figuresOf(sums),
            months: months.map(seriesOf(rowMonths.get(sums.key) ?? [])),
          }),
        ).toSorted(largestFirst)
      : [],
  } satisfies SpendingBreakdown;
});

export class Spending extends Context.Service<
  Spending,
  {
    readonly breakdown: (input: SpendingInput) => Effect.Effect<SpendingBreakdown, FinanceError>;
  }
>()("@repo/api/analysis/Spending") {
  static readonly layer = Layer.effect(
    Spending,
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      const breakdown = Effect.fn("Spending.breakdown")(
        (input: SpendingInput) => readTransaction(sql, breakdownOf(input)),
        Effect.provideService(PgClient.PgClient, sql),
        toFinanceError,
      );
      return Spending.of({ breakdown });
    }),
  );
}

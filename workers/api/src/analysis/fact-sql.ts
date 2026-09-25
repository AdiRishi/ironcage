import type {
  CategoryId,
  CategoryScope,
  CounterpartyScope,
  DateBasis,
  FlowDirection,
  Period,
} from "@repo/contracts/finance";
import { factDirection, type MeasurePart } from "@repo/finance";
import { Schema } from "effect";
import type { SqlClient, Statement } from "effect/unstable/sql";

// Predicates over `ledger_facts f`. Reads that sum or list facts build their selections
// from these, so a number and the records behind it select the same facts.

export const factDate = (sql: SqlClient.SqlClient, basis: typeof DateBasis.Type) =>
  basis === "spending" ? sql`f.spending_on` : sql`f.posted_on`;

export const factsIn = (sql: SqlClient.SqlClient, basis: typeof DateBasis.Type, period: Period) => {
  const on = factDate(sql, basis);
  return sql`${on} >= ${period.start}::date AND ${on} < ${period.endExclusive}::date`;
};

// The sums `changeFigures` reads, over the facts in `current` and in `previous`, and the
// part of the current amount the model placed. A purchase counts once in a group, however
// its allocations divide it.
export const periodSums = (
  sql: SqlClient.SqlClient,
  current: Statement.Fragment,
  previous: Statement.Fragment,
) => sql`COALESCE(sum(f.amount_minor) FILTER (WHERE ${current}), 0)::text AS current,
  COALESCE(sum(f.amount_minor) FILTER (WHERE ${previous}), 0)::text AS previous,
  COALESCE(sum(f.amount_minor) FILTER (WHERE ${current} AND f.model_assigned), 0)::text AS "modelCurrent",
  COALESCE(sum(f.amount_minor) FILTER (WHERE ${current} AND f.purchase), 0)::text AS "purchaseCurrent",
  COALESCE(sum(f.amount_minor) FILTER (WHERE ${previous} AND f.purchase), 0)::text AS "purchasePrevious",
  count(DISTINCT f.event_id) FILTER (WHERE ${current} AND f.purchase AND f.amount_minor > 0)::int AS purchases,
  count(DISTINCT f.event_id) FILTER (WHERE ${previous} AND f.purchase AND f.amount_minor > 0)::int AS "previousPurchases"`;
export const PeriodSums = Schema.Struct({
  current: Schema.BigIntFromString,
  previous: Schema.BigIntFromString,
  modelCurrent: Schema.BigIntFromString,
  purchaseCurrent: Schema.BigIntFromString,
  purchasePrevious: Schema.BigIntFromString,
  purchases: Schema.Int,
  previousPurchases: Schema.Int,
});

// Loan principal takes off the interest and fees charged on loan accounts.
export const onLoanAccount = (sql: SqlClient.SqlClient) =>
  sql`f.account_id IN (SELECT id FROM accounts WHERE kind = 'loan')`;

export const partFacts = (sql: SqlClient.SqlClient, part: MeasurePart) =>
  part.loanAccounts
    ? sql`(f.measure = ${part.fact} AND ${onLoanAccount(sql)})`
    : sql`f.measure = ${part.fact}`;

// Facts whose money moved in, or out.
export const factsGoing = (sql: SqlClient.SqlClient, direction: FlowDirection) =>
  sql.in(
    "f.measure",
    Object.entries(factDirection).flatMap(([measure, going]) =>
      going === direction ? [measure] : [],
    ),
  );

export const categorySubtree = (sql: SqlClient.SqlClient, id: typeof CategoryId.Type) =>
  sql`WITH RECURSIVE tree AS (SELECT id FROM categories WHERE id = ${id} UNION ALL SELECT c.id FROM categories c JOIN tree ON c.parent_id = tree.id) SELECT id FROM tree`;

export function categoryFacts(sql: SqlClient.SqlClient, scope: CategoryScope) {
  switch (scope.kind) {
    case "all":
      return sql`true`;
    case "category":
      return sql`f.category_id IN (${categorySubtree(sql, scope.id)})`;
    case "unspecified":
      return sql`f.category_id = ${scope.id}`;
    case "uncategorised":
      return sql`f.category_id IS NULL`;
  }
}

export function counterpartyFacts(sql: SqlClient.SqlClient, scope: CounterpartyScope) {
  switch (scope.kind) {
    case "all":
      return sql`true`;
    case "counterparty":
      return sql`f.counterparty_id = ${scope.id}`;
    case "unidentified":
      return sql`f.counterparty_id IS NULL`;
  }
}

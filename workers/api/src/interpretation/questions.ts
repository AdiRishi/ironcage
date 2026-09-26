import { PgClient } from "@effect/sql-pg";
import {
  CategoryId,
  CategoryTree,
  CounterpartyId,
  CounterpartyRole,
  Confidence,
  type FinanceError,
  type ListQuestions,
  MinorUnits,
  Question,
  QuestionKind,
  type QuestionPage,
  type QuestionSummary,
  questionFilterKinds,
  type SummarizeQuestions,
} from "@repo/contracts/finance";
import { personProposal } from "@repo/finance";
import { Context, Effect, Layer, Record, Schema, Struct } from "effect";
import type { Statement } from "effect/unstable/sql";

import { resolveSelection } from "../analysis/periods.ts";
import { counterpartyColumns } from "../database/columns.ts";
import { toFinanceError } from "../database/failures.ts";
import { readTransaction } from "../database/transactions.ts";
import { questionEventsTable } from "./question-events.ts";

const pageSize = 25;

// A question as the page query reads it. A person question carries the model's defaults
// when the model proposed the person, for `personProposal`.
const QuestionRow = Schema.Struct({
  rank: MinorUnits,
  question: Schema.Union([
    Question.cases.counterparty,
    Question.cases.alias,
    Schema.Struct({
      ...Struct.omit(Question.cases.person.fields, ["proposal"]),
      model: Schema.NullOr(
        Schema.Struct({
          role: Schema.NullOr(CounterpartyRole),
          categoryId: Schema.NullOr(CategoryId),
          confidence: Confidence,
          reason: Schema.String,
        }),
      ),
    }),
    Question.cases.ownAccount,
    Question.cases.unresolved,
    Question.cases.ruleConflict,
  ]),
});

const resolvePeriod = (selection: (typeof ListQuestions.Type)["period"]) =>
  selection
    ? Effect.map(resolveSelection(selection), ({ period }) => period)
    : Effect.succeed(null);

// Questions with the most money first. With a period, only those with a transaction whose
// spending date falls in it, ranked by the money of those transactions.
const listQuestions = Effect.fn("listQuestions")(function* ({
  currency,
  filter,
  period: selection,
  cursor,
}: typeof ListQuestions.Type) {
  const sql = yield* PgClient.PgClient;
  const period = yield* resolvePeriod(selection);
  const questions = yield* questionEventsTable(period);
  const money = (minor: Statement.Fragment | Statement.Identifier) =>
    sql`jsonb_build_object('currency', ${currency}::text, 'minor', (${minor})::text)`;
  const reach = (count: string, outflow: string, inflow: string) =>
    sql`'eventCount', ${sql(count)}, 'outflow', ${money(sql(outflow))}, 'inflow', ${money(sql(inflow))}`;
  const predicates: Statement.Fragment[] = [];
  if (filter) predicates.push(sql.in("r.kind", questionFilterKinds[filter]));
  if (cursor)
    predicates.push(
      sql`(r.rank < ${cursor.rankMinor} OR (r.rank = ${cursor.rankMinor} AND r.key > ${cursor.id}))`,
    );
  const rows = yield* sql`WITH ${questions}, groups AS (
      SELECT key, min(kind) AS kind, min(alias_key) AS alias_key, min(counterparty_id::text)::uuid AS counterparty_id,
        min(reference_key) AS reference_key, min(reference) AS reference,
        min(event_id::text) AS event_id, min(posting_id::text) AS posting_id, (array_agg(rules))[1] AS rules,
        count(*)::int AS event_count,
        COALESCE(-sum(amount_minor) FILTER (WHERE amount_minor < 0), 0) AS outflow,
        COALESCE(sum(amount_minor) FILTER (WHERE amount_minor > 0), 0) AS inflow,
        min(posted_on) AS first_on, max(posted_on) AS last_on,
        count(*) FILTER (WHERE in_period)::int AS period_count,
        COALESCE(-sum(amount_minor) FILTER (WHERE in_period AND amount_minor < 0), 0) AS period_outflow,
        COALESCE(sum(amount_minor) FILTER (WHERE in_period AND amount_minor > 0), 0) AS period_inflow,
        (array_agg(jsonb_build_object('eventId', event_id, 'postingId', posting_id, 'postedOn', posted_on::text,
          'description', description, 'amount', ${money(sql`amount_minor`)})
          ORDER BY in_period DESC, posted_on DESC, event_id))[1:5] AS samples
      FROM question_events WHERE currency = ${currency}
      GROUP BY key HAVING count(*) FILTER (WHERE in_period) > 0
    ), ranked AS (
      SELECT *, ${period ? sql`period_outflow + period_inflow` : sql`outflow + inflow`} AS rank FROM groups
    )
    SELECT r.rank::text AS rank, jsonb_build_object(
        'kind', r.kind, 'id', r.key,
        'affects', jsonb_build_object(${reach("r.event_count", "r.outflow", "r.inflow")},
          'firstOn', r.first_on::text, 'lastOn', r.last_on::text),
        'affectsInPeriod', ${period ? sql`jsonb_build_object(${reach("r.period_count", "r.period_outflow", "r.period_inflow")})` : sql`NULL::jsonb`},
        'samples', to_jsonb(r.samples),
        'counterparty', CASE WHEN c.id IS NOT NULL THEN (SELECT to_jsonb(x) FROM (SELECT ${counterpartyColumns(sql)}) x) END,
        'basis', CASE r.kind
          WHEN 'alias' THEN jsonb_build_object('kind', 'model', 'confidence', a.confidence::float8, 'reason', a.reason)
          WHEN 'counterparty' THEN jsonb_build_object('kind', 'model', 'confidence', c.confidence::float8, 'reason', c.reason) END,
        'model', CASE WHEN c.status = 'proposed' THEN jsonb_build_object('role', c.default_role,
          'categoryId', c.default_category_id, 'confidence', c.confidence::float8, 'reason', c.reason) END,
        'aliasKey', r.alias_key, 'aliasVersion', a.version,
        'reference', CASE WHEN r.reference_key IS NOT NULL THEN jsonb_build_object('key', r.reference_key, 'sample', r.reference) END,
        'subject', CASE WHEN r.alias_key IS NULL THEN jsonb_build_object('kind', 'event', 'eventId', r.event_id, 'postingId', r.posting_id)
          ELSE jsonb_build_object('kind', 'alias', 'aliasKey', r.alias_key, 'aliasVersion', a.version) END,
        'eventId', r.event_id, 'postingId', r.posting_id, 'rules', r.rules) AS question
    FROM ranked r
    LEFT JOIN counterparties c ON c.id = r.counterparty_id
    LEFT JOIN counterparty_aliases a ON a.alias_key = r.alias_key
    WHERE ${sql.and(predicates)}
    ORDER BY r.rank DESC, r.key LIMIT ${pageSize + 1}`.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(QuestionRow))),
  );
  const shown = rows.slice(0, pageSize);

  const people = shown.flatMap(({ question }) => (question.kind === "person" ? [question] : []));
  const referenceKeys = people.flatMap((question) =>
    question.reference ? [question.reference.key] : [],
  );
  const answers =
    yield* sql`SELECT r.reference_key AS "referenceKey", c.id AS "counterpartyId", c.name AS "counterpartyName",
        r.default_role AS "defaultRole", r.default_category_id AS "defaultCategoryId"
      FROM counterparty_references r JOIN counterparties c ON c.id = r.counterparty_id
      WHERE ${sql.in("r.reference_key", referenceKeys)} ORDER BY c.name, c.id`.pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(
          Schema.Array(
            Schema.Struct({
              referenceKey: Schema.String,
              counterpartyId: CounterpartyId,
              counterpartyName: Schema.String,
              defaultRole: CounterpartyRole,
              defaultCategoryId: Schema.NullOr(CategoryId),
            }),
          ),
        ),
      ),
    );
  const categories = yield* sql`SELECT id, name, tree FROM categories WHERE NOT archived`.pipe(
    Effect.flatMap(
      Schema.decodeUnknownEffect(
        Schema.Array(Schema.Struct({ id: CategoryId, name: Schema.String, tree: CategoryTree })),
      ),
    ),
  );

  const last = shown.at(-1);
  return {
    rows: shown.map(({ question }): Question => {
      if (question.kind !== "person") return question;
      const { model, ...person } = question;
      return {
        ...person,
        proposal: personProposal({
          direction: person.affects.outflow.minor >= person.affects.inflow.minor ? "out" : "in",
          referenceKey: person.reference?.key ?? null,
          answers: answers.filter(
            (answer) =>
              answer.referenceKey === person.reference?.key &&
              answer.counterpartyId !== person.counterparty.id,
          ),
          categories,
          model,
        }),
      };
    }),
    nextCursor:
      rows.length > pageSize && last ? { rankMinor: last.rank, id: last.question.id } : null,
  } satisfies typeof QuestionPage.Type;
});

// How many questions there are in each filter and the money their transactions move,
// counting each transaction once. With a period, only questions and transactions whose
// spending date falls in it.
const summarizeQuestions = Effect.fn("summarizeQuestions")(function* ({
  currency,
  period: selection,
}: typeof SummarizeQuestions.Type) {
  const sql = yield* PgClient.PgClient;
  const period = yield* resolvePeriod(selection);
  const questions = yield* questionEventsTable(period);
  const [totals] =
    yield* sql`WITH ${questions}, counted AS (SELECT kind, key, event_id, amount_minor FROM question_events WHERE currency = ${currency} AND in_period),
      moved AS (SELECT DISTINCT event_id, amount_minor FROM counted)
    SELECT COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', kind, 'questions', questions))
        FROM (SELECT kind, count(DISTINCT key)::int AS questions FROM counted GROUP BY kind) k), '[]') AS kinds,
      (SELECT COALESCE(-sum(amount_minor) FILTER (WHERE amount_minor < 0), 0) FROM moved)::text AS outflow,
      (SELECT COALESCE(sum(amount_minor) FILTER (WHERE amount_minor > 0), 0) FROM moved)::text AS inflow`.pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(
          Schema.Tuple([
            Schema.Struct({
              kinds: Schema.Array(Schema.Struct({ kind: QuestionKind, questions: Schema.Int })),
              outflow: MinorUnits,
              inflow: MinorUnits,
            }),
          ]),
        ),
      ),
    );
  const count = (kinds: readonly QuestionKind[]) =>
    totals.kinds
      .filter((row) => kinds.includes(row.kind))
      .reduce((sum, row) => sum + row.questions, 0);
  return {
    period,
    count: count(QuestionKind.literals),
    byFilter: Record.map(questionFilterKinds, count),
    outflow: { currency, minor: totals.outflow },
    inflow: { currency, minor: totals.inflow },
  } satisfies typeof QuestionSummary.Type;
});

export class Questions extends Context.Service<
  Questions,
  {
    readonly list: (
      input: typeof ListQuestions.Type,
    ) => Effect.Effect<typeof QuestionPage.Type, FinanceError>;
    readonly summary: (
      input: typeof SummarizeQuestions.Type,
    ) => Effect.Effect<typeof QuestionSummary.Type, FinanceError>;
  }
>()("@repo/api/interpretation/Questions") {
  static readonly layer = Layer.effect(
    Questions,
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      const list = Effect.fn("Questions.list")(
        (input: typeof ListQuestions.Type) => readTransaction(sql, listQuestions(input)),
        Effect.provideService(PgClient.PgClient, sql),
        toFinanceError,
      );
      const summary = Effect.fn("Questions.summary")(
        (input: typeof SummarizeQuestions.Type) => readTransaction(sql, summarizeQuestions(input)),
        Effect.provideService(PgClient.PgClient, sql),
        toFinanceError,
      );
      return Questions.of({ list, summary });
    }),
  );
}

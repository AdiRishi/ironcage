import type { FigureValue, RecordLink } from "@repo/contracts/analyst";
import {
  FinanceError,
  ListQuestions as ListQuestionsInput,
  MonthsSelection,
  type Question,
  type QuestionFilter,
  QuestionKind,
} from "@repo/contracts/finance";
import { dateLabel, periodLabel } from "@repo/finance";
import type { Api } from "@repo/infra/api";
import { Effect, Schema } from "effect";
import { Tool } from "effect/unstable/ai";

import {
  arrived,
  cite,
  count,
  FigureView,
  money,
  placedBy,
  type ReadBasis,
} from "../evidence/present.ts";
import { TurnEvidence } from "../evidence/service.ts";
import { coverageOf } from "./coverage.ts";

// The most questions one list shows the model. The screen shows the rest.
const listed = 10;

const filterLabels = {
  who: "about who a payment was with",
  people: "about payments with people",
  accounts: "about your own accounts",
  rules: "where rules disagree",
} satisfies Record<QuestionFilter, string>;

// Who or what a question asks about, in the fields bank text may fill.
const subjectOf = (question: Question) => {
  switch (question.kind) {
    case "counterparty":
      return { counterparty: question.counterparty.name, counterpartyText: null, reference: null };
    case "alias":
      return {
        counterparty: question.counterparty.name,
        counterpartyText: question.aliasKey,
        reference: null,
      };
    case "person":
      return {
        counterparty: question.counterparty.name,
        counterpartyText: null,
        reference: question.reference?.sample ?? null,
      };
    case "ownAccount":
      return { counterparty: null, counterpartyText: question.aliasKey, reference: null };
    case "unresolved":
      return {
        counterparty: null,
        counterpartyText: question.subject.kind === "alias" ? question.subject.aliasKey : null,
        reference: null,
      };
    case "ruleConflict":
      return { counterparty: null, counterpartyText: null, reference: null };
  }
};

export const ListQuestions = Tool.make("ListQuestions", {
  description:
    "Open questions about your records over whole months, or over all of them without a " +
    "period: how many there are, the money their transactions move, and the questions " +
    "that move the most. Answering them makes every total more certain.",
  parameters: Schema.Struct({
    period: Schema.NullOr(MonthsSelection),
    filter: ListQuestionsInput.fields.filter,
  }),
  success: Schema.Struct({
    questions: FigureView,
    moneyOut: FigureView,
    moneyIn: FigureView,
    // Questions about who a payment was with, payments with people, your own accounts, and
    // rules that disagree.
    byFilter: Schema.Struct({
      who: FigureView,
      people: FigureView,
      accounts: FigureView,
      rules: FigureView,
    }),
    largest: Schema.Array(
      Schema.Struct({
        kind: QuestionKind,
        counterparty: Schema.NullOr(Schema.String),
        counterpartyText: Schema.NullOr(Schema.String),
        reference: Schema.NullOr(Schema.String),
        transactions: FigureView,
        moneyOut: FigureView,
        moneyIn: FigureView,
        firstOn: Schema.String,
        lastOn: Schema.String,
        bankDescription: Schema.Array(Schema.String),
      }),
    ),
  }),
  failure: FinanceError,
  failureMode: "return",
  dependencies: [TurnEvidence],
});

export const listQuestions = (
  api: Pick<Api, "summarizeQuestions" | "listQuestions" | "getCoverage">,
) =>
  Effect.fn("ListQuestions")(function* ({ period, filter }: Tool.Parameters<typeof ListQuestions>) {
    const evidence = yield* TurnEvidence;
    const { currency } = evidence;
    const [summary, page, read] = yield* Effect.all(
      [
        api.summarizeQuestions({ currency, period }),
        api.listQuestions({ currency, filter, period, cursor: null }),
        // Questions over all your records place their figures in no period.
        period === null
          ? arrived.pipe(Effect.map((calculatedAt): ReadBasis => ({ calculatedAt, placed: null })))
          : coverageOf(api, period).pipe(Effect.map(placedBy)),
      ],
      { concurrency: "unbounded" },
    );
    const where = summary.period === null ? "all your records" : periodLabel(summary.period);
    const records = { kind: "questions", period } satisfies RecordLink;
    const figure = (label: string, value: FigureValue) => cite(read, label, value, records);
    const byFilter = (filter: QuestionFilter) =>
      figure(
        `Open questions ${filterLabels[filter]} in ${where}`,
        count(summary.byFilter[filter], "question"),
      );
    yield* evidence.step({ label: `Reading the open questions in ${where}`, records });
    const shown = page.rows.slice(0, listed);
    if (page.rows.length > shown.length || page.nextCursor !== null)
      yield* evidence.limit({ kind: "partialList", shown: shown.length, records });
    yield* evidence.names(shown.map((question) => subjectOf(question).counterparty));
    return {
      questions: yield* figure(`Open questions in ${where}`, count(summary.count, "question")),
      moneyOut: yield* figure(
        `Money out behind open questions in ${where}`,
        money(summary.outflow),
      ),
      moneyIn: yield* figure(`Money in behind open questions in ${where}`, money(summary.inflow)),
      byFilter: {
        who: yield* byFilter("who"),
        people: yield* byFilter("people"),
        accounts: yield* byFilter("accounts"),
        rules: yield* byFilter("rules"),
      },
      largest: yield* Effect.forEach(
        shown,
        Effect.fnUntraced(function* (question) {
          const reach = question.affectsInPeriod ?? question.affects;
          const subject = subjectOf(question);
          const about = `A question about ${subject.counterparty ?? subject.counterpartyText ?? "one transaction"} in ${where}`;
          return {
            kind: question.kind,
            ...subject,
            transactions: yield* cite(
              read,
              `${about}, transactions`,
              count(reach.eventCount, "transaction"),
              records,
            ),
            moneyOut: yield* cite(read, `${about}, money out`, money(reach.outflow), records),
            moneyIn: yield* cite(read, `${about}, money in`, money(reach.inflow), records),
            firstOn: dateLabel(question.affects.firstOn),
            lastOn: dateLabel(question.affects.lastOn),
            bankDescription: question.samples.map((sample) => sample.description),
          };
        }),
      ),
    };
  });

import { Schema, Struct } from "effect";

import { Period, PeriodSelection } from "./analysis.ts";
import { Counterparty } from "./counterparties.ts";
import { Confidence } from "./enrichment.ts";
import { CategoryId, CounterpartyId, EventId, PersonRole, QuestionId } from "./interpretation.ts";
import { Rule } from "./rules.ts";
import { CalendarDate, Currency, MinorUnits, Money, PostingId, Version } from "./values.ts";

export const QuestionKind = Schema.Literals([
  "counterparty",
  "alias",
  "person",
  "ownAccount",
  "unresolved",
  "ruleConflict",
]);
export type QuestionKind = typeof QuestionKind.Type;
// The groups of kinds that the Questions screen filters by.
export const QuestionFilter = Schema.Literals(["who", "people", "accounts", "rules"]);
export type QuestionFilter = typeof QuestionFilter.Type;
export const questionFilterKinds = {
  who: ["counterparty", "alias", "unresolved"],
  people: ["person"],
  accounts: ["ownAccount"],
  rules: ["ruleConflict"],
} satisfies Record<QuestionFilter, readonly QuestionKind[]>;

export const QuestionSample = Schema.Struct({
  eventId: EventId,
  postingId: PostingId,
  postedOn: CalendarDate,
  description: Schema.String,
  amount: Money,
});
// The transactions a question covers and the money they move each way.
export const QuestionReach = Schema.Struct({
  eventCount: Schema.Int,
  outflow: Money,
  inflow: Money,
});
// `firstOn` and `lastOn` are the posted dates of the first and last transaction.
export const QuestionAffects = Schema.Struct({
  ...QuestionReach.fields,
  firstOn: CalendarDate,
  lastOn: CalendarDate,
});

export const ModelBasis = Schema.Struct({
  kind: Schema.Literal("model"),
  confidence: Confidence,
  reason: Schema.String,
});
// Why payments to a person are proposed to be something: your default for the same
// reference key on another counterparty, a category the reference names, or the model.
export const RoleBasis = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("answer"),
    counterpartyId: CounterpartyId,
    counterpartyName: Schema.String,
  }),
  Schema.Struct({ kind: Schema.Literal("reference") }),
  ModelBasis,
]).pipe(Schema.toTaggedUnion("kind"));
export const RoleProposal = Schema.Struct({
  role: PersonRole,
  categoryId: Schema.NullOr(CategoryId),
  basis: RoleBasis,
});
export type RoleProposal = typeof RoleProposal.Type;

// `affectsInPeriod` covers the transactions whose spending date falls in the period the
// list was narrowed to, and is null when it was not narrowed. `samples` holds up to five of
// the transactions, those in the period first.
const QuestionBase = Schema.Struct({
  id: QuestionId,
  affects: QuestionAffects,
  affectsInPeriod: Schema.NullOr(QuestionReach),
  samples: Schema.NonEmptyArray(QuestionSample),
});
// Each kind carries the versions its answers expect. An alias version is null while no
// counterparty holds the alias key.
export const Question = Schema.Union([
  // The model proposed the counterparty, so it lends no defaults until you confirm it.
  Schema.Struct({
    kind: Schema.Literal("counterparty"),
    ...QuestionBase.fields,
    counterparty: Counterparty,
    basis: ModelBasis,
  }),
  // The model thinks the alias key belongs to `counterparty`. Its transactions have no
  // counterparty until you answer.
  Schema.Struct({
    kind: Schema.Literal("alias"),
    ...QuestionBase.fields,
    aliasKey: Schema.String,
    aliasVersion: Version,
    counterparty: Counterparty,
    basis: ModelBasis,
  }),
  // Payments with a person that carry one reference key, or none. `sample` is one
  // reference as printed. `proposal` is null when nothing suggests what they are.
  Schema.Struct({
    kind: Schema.Literal("person"),
    ...QuestionBase.fields,
    counterparty: Counterparty,
    reference: Schema.NullOr(Schema.Struct({ key: Schema.String, sample: Schema.String })),
    proposal: Schema.NullOr(RoleProposal),
  }),
  // Transfers to an account number that matches none of your accounts.
  Schema.Struct({
    kind: Schema.Literal("ownAccount"),
    ...QuestionBase.fields,
    aliasKey: Schema.String,
    aliasVersion: Schema.NullOr(Version),
  }),
  // Transactions that nothing gives a role, asked about per alias key, or one at a time
  // when the bank printed no name.
  Schema.Struct({
    kind: Schema.Literal("unresolved"),
    ...QuestionBase.fields,
    subject: Schema.Union([
      Schema.Struct({
        kind: Schema.Literal("alias"),
        aliasKey: Schema.String,
        aliasVersion: Schema.NullOr(Version),
      }),
      Schema.Struct({ kind: Schema.Literal("event"), eventId: EventId, postingId: PostingId }),
    ]).pipe(Schema.toTaggedUnion("kind")),
  }),
  // Rules that match one transaction and set different values for it.
  Schema.Struct({
    kind: Schema.Literal("ruleConflict"),
    ...QuestionBase.fields,
    eventId: EventId,
    postingId: PostingId,
    rules: Schema.Array(Schema.Struct(Struct.pick(Rule.fields, ["id", "name", "action"]))),
  }),
]).pipe(Schema.toTaggedUnion("kind"));
export type Question = typeof Question.Type;

// Questions run from the most money to the least, then by ID. `rankMinor` is the money
// that placed the last question on a page.
export const QuestionCursor = Schema.Struct({ rankMinor: MinorUnits, id: QuestionId });
// With a period, only questions with a transaction whose spending date falls in it, ranked
// by the money of those transactions.
export const ListQuestions = Schema.Struct({
  currency: Currency,
  filter: Schema.NullOr(QuestionFilter),
  period: Schema.NullOr(PeriodSelection),
  cursor: Schema.NullOr(QuestionCursor),
});
export const QuestionPage = Schema.Struct({
  rows: Schema.Array(Question),
  nextCursor: Schema.NullOr(QuestionCursor),
});
export const SummarizeQuestions = Schema.Struct({
  currency: Currency,
  period: Schema.NullOr(PeriodSelection),
});
// Every open question, or with a period, those with a transaction whose spending date falls
// in it. The money counts only those transactions. `period` is the period resolved.
export const QuestionSummary = Schema.Struct({
  period: Schema.NullOr(Period),
  count: Schema.Int,
  byFilter: Schema.Record(QuestionFilter, Schema.Int),
  outflow: Money,
  inflow: Money,
});

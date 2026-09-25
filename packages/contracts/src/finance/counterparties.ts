import { Schema } from "effect";

import {
  CategoryId,
  Channel,
  CounterpartyId,
  CounterpartyKind,
  CounterpartyRole,
  EventId,
} from "./interpretation.ts";
import {
  CalendarDate,
  CommandId,
  Instant,
  Money,
  PostingId,
  Version,
  YearMonth,
} from "./values.ts";

export const AssignmentAuthor = Schema.Literals(["user", "model"]);
export const Counterparty = Schema.Struct({
  id: CounterpartyId,
  name: Schema.String,
  kind: CounterpartyKind,
  brand: Schema.NullOr(Schema.String),
  defaultCategoryId: Schema.NullOr(CategoryId),
  defaultRole: Schema.NullOr(CounterpartyRole),
  source: AssignmentAuthor,
  status: Schema.Literals(["applied", "proposed"]),
  model: Schema.NullOr(Schema.String),
  confidence: Schema.NullOr(Schema.Finite),
  reason: Schema.NullOr(Schema.String),
  version: Version,
  updatedAt: Instant,
});
export type Counterparty = typeof Counterparty.Type;

export const CounterpartySummary = Schema.Struct({
  ...Counterparty.fields,
  eventCount: Schema.Int,
  outflow: Money,
  inflow: Money,
  lastOn: Schema.NullOr(CalendarDate),
});
export const ListCounterparties = Schema.Struct({
  search: Schema.String.check(Schema.isMaxLength(100)),
  currency: Schema.String,
  period: Schema.NullOr(Schema.Struct({ start: CalendarDate, endExclusive: CalendarDate })),
});
export const CounterpartyList = Schema.Array(CounterpartySummary);

export const CounterpartyAlias = Schema.Struct({
  aliasKey: Schema.String,
  source: AssignmentAuthor,
  samples: Schema.Array(Schema.String),
  channel: Schema.NullOr(Channel),
  eventCount: Schema.Int,
});
export const CounterpartyMonth = Schema.Struct({
  month: YearMonth,
  outflow: Money,
  inflow: Money,
});
// The references on payments with one counterparty, most frequent first, with the
// defaults you set for any of them.
export const CounterpartyReference = Schema.Struct({
  referenceKey: Schema.String,
  sample: Schema.String,
  eventCount: Schema.Int,
  defaultRole: Schema.NullOr(CounterpartyRole),
  defaultCategoryId: Schema.NullOr(CategoryId),
});
export const CounterpartyDetail = Schema.Struct({
  counterparty: CounterpartySummary,
  aliases: Schema.Array(CounterpartyAlias),
  months: Schema.Array(CounterpartyMonth),
  references: Schema.Array(CounterpartyReference),
});
export const CounterpartyInput = Schema.Struct({ counterpartyId: CounterpartyId });

const Name = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(120));
export const CounterpartyFields = Schema.Struct({
  name: Name,
  kind: CounterpartyKind,
  brand: Schema.NullOr(Name),
  defaultCategoryId: Schema.NullOr(CategoryId),
  defaultRole: Schema.NullOr(CounterpartyRole),
});
export const SaveCounterparty = Schema.Struct({
  commandId: CommandId,
  target: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("create"), aliasKeys: Schema.Array(Schema.String) }),
    Schema.Struct({ kind: Schema.Literal("update"), id: CounterpartyId, expectedVersion: Version }),
  ]),
  fields: CounterpartyFields,
});
export const MergeCounterparties = Schema.Struct({
  commandId: CommandId,
  sourceId: CounterpartyId,
  sourceVersion: Version,
  targetId: CounterpartyId,
  targetVersion: Version,
});
// Sets what payments with one counterparty and one reference are, ahead of the
// counterparty's own default.
export const SaveReferenceDefault = Schema.Struct({
  commandId: CommandId,
  counterpartyId: CounterpartyId,
  referenceKey: Schema.NonEmptyString,
  defaultRole: CounterpartyRole,
  defaultCategoryId: Schema.NullOr(CategoryId),
});
export const DeleteReferenceDefault = Schema.Struct({
  commandId: CommandId,
  counterpartyId: CounterpartyId,
  referenceKey: Schema.NonEmptyString,
});
export const MoveAlias = Schema.Struct({
  commandId: CommandId,
  aliasKey: Schema.String,
  counterpartyId: CounterpartyId,
});
export const AssignEventCounterparty = Schema.Struct({
  commandId: CommandId,
  eventId: EventId,
  expectedVersion: Version,
  counterpartyId: Schema.NullOr(CounterpartyId),
});
export const ReinterpretPostings = Schema.Struct({ commandId: CommandId });
export const ReinterpretationSummary = Schema.Struct({
  descriptors: Schema.Int,
  created: Schema.Int,
  changed: Schema.Int,
});

export const QuestionKind = Schema.Literals([
  "counterparty",
  "alias",
  "person",
  "ownAccount",
  "unresolved",
  "ruleConflict",
]);
export type QuestionKind = typeof QuestionKind.Type;
export const QuestionSample = Schema.Struct({
  eventId: EventId,
  postingId: PostingId,
  postedOn: CalendarDate,
  description: Schema.String,
  amount: Money,
});
export const Question = Schema.Struct({
  id: Schema.String,
  kind: QuestionKind,
  aliasKey: Schema.NullOr(Schema.String),
  // For a person question: the payments' reference key and one reference as printed.
  reference: Schema.NullOr(Schema.Struct({ key: Schema.String, sample: Schema.String })),
  counterparty: Schema.NullOr(Counterparty),
  // For an alias question: the model's confidence and reason that the alias belongs
  // to the counterparty.
  proposal: Schema.NullOr(Schema.Struct({ confidence: Schema.Finite, reason: Schema.String })),
  eventCount: Schema.Int,
  outflow: Money,
  inflow: Money,
  samples: Schema.Array(QuestionSample),
});
export type Question = typeof Question.Type;
export const ListQuestions = Schema.Struct({ currency: Schema.String });
export const QuestionList = Schema.Array(Question);

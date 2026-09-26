import { Schema } from "effect";

import { CoverageState, FlowDirection } from "./analysis.ts";
import { ExpectedEventVersion, MeasureImpact } from "./corrections.ts";
import { FinancialEvent } from "./events.ts";
import {
  CategoryId,
  Channel,
  CounterpartyId,
  CounterpartyKind,
  CounterpartyRole,
} from "./interpretation.ts";
import { CalendarDate, CommandId, Instant, Money, Version, YearMonth } from "./values.ts";

export const AssignmentAuthor = Schema.Literals(["user", "model"]);
// A proposed counterparty or alias waits for your answer to a question. Until then a
// proposed alias names no counterparty, and a proposed counterparty lends no defaults.
export const AssignmentStatus = Schema.Literals(["applied", "proposed"]);
export const Counterparty = Schema.Struct({
  id: CounterpartyId,
  name: Schema.String,
  kind: CounterpartyKind,
  brand: Schema.NullOr(Schema.String),
  defaultCategoryId: Schema.NullOr(CategoryId),
  defaultRole: Schema.NullOr(CounterpartyRole),
  source: AssignmentAuthor,
  status: AssignmentStatus,
  model: Schema.NullOr(Schema.String),
  confidence: Schema.NullOr(Schema.Finite),
  reason: Schema.NullOr(Schema.String),
  version: Version,
  updatedAt: Instant,
});
export type Counterparty = typeof Counterparty.Type;

// `outflowEvents` and `inflowEvents` count the transactions behind each amount. A
// refund counts toward the outflow it reduces.
export const CounterpartySummary = Schema.Struct({
  ...Counterparty.fields,
  eventCount: Schema.Int,
  outflowEvents: Schema.Int,
  inflowEvents: Schema.Int,
  outflow: Money,
  inflow: Money,
  lastOn: Schema.NullOr(CalendarDate),
});
export const ListCounterparties = Schema.Struct({
  search: Schema.Trim.check(Schema.isMaxLength(100)),
  currency: Schema.String,
  period: Schema.NullOr(Schema.Struct({ start: CalendarDate, endExclusive: CalendarDate })),
  direction: FlowDirection,
});
export const CounterpartyList = Schema.Array(CounterpartySummary);

export const CounterpartyAlias = Schema.Struct({
  aliasKey: Schema.String,
  source: AssignmentAuthor,
  status: AssignmentStatus,
  version: Version,
  samples: Schema.Array(Schema.String),
  channel: Schema.NullOr(Channel),
  eventCount: Schema.Int,
});
// `coverage` is the month's records on the accounts the counterparty's transactions use.
export const CounterpartyMonth = Schema.Struct({
  month: YearMonth,
  outflow: Money,
  inflow: Money,
  coverage: CoverageState,
});
// The references on payments with one counterparty, most frequent first, with the
// defaults you set for any of them. `version` is null until you set one.
export const CounterpartyReference = Schema.Struct({
  referenceKey: Schema.String,
  sample: Schema.String,
  eventCount: Schema.Int,
  defaultRole: Schema.NullOr(CounterpartyRole),
  defaultCategoryId: Schema.NullOr(CategoryId),
  version: Schema.NullOr(Version),
});
export const CounterpartyDetail = Schema.Struct({
  counterparty: CounterpartySummary,
  aliases: Schema.Array(CounterpartyAlias),
  months: Schema.Array(CounterpartyMonth),
  references: Schema.Array(CounterpartyReference),
});
export const CounterpartyInput = Schema.Struct({ counterpartyId: CounterpartyId });

// Descriptors whose printed text or alias key contains the search, or whose
// counterparty's name does, except those already applied to `excludeCounterpartyId`.
export const SearchDescriptors = Schema.Struct({
  search: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  excludeCounterpartyId: Schema.NullOr(CounterpartyId),
});
// One alias key with the text the bank printed for it and the counterparty that holds
// it. `alias` is null when no counterparty holds it.
export const DescriptorMatch = Schema.Struct({
  aliasKey: Schema.String,
  samples: Schema.Array(Schema.String),
  eventCount: Schema.Int,
  alias: Schema.NullOr(
    Schema.Struct({
      counterpartyId: CounterpartyId,
      counterpartyName: Schema.String,
      status: AssignmentStatus,
      source: AssignmentAuthor,
      version: Version,
    }),
  ),
});
export const DescriptorMatches = Schema.Array(DescriptorMatch);

const Name = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(120));
export const CounterpartyFields = Schema.Struct({
  name: Name,
  kind: CounterpartyKind,
  brand: Schema.NullOr(Name),
  defaultCategoryId: Schema.NullOr(CategoryId),
  defaultRole: Schema.NullOr(CounterpartyRole),
});
// One change to counterparties, their descriptors, or their reference defaults. Each
// carries the version of every record it changes as you saw it; a null version says the
// record did not exist.
export const CounterpartyChange = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("create"),
    fields: CounterpartyFields,
    aliases: Schema.Array(
      Schema.Struct({ aliasKey: Schema.NonEmptyString, expectedVersion: Schema.NullOr(Version) }),
    ),
  }),
  Schema.Struct({
    kind: Schema.Literal("update"),
    counterpartyId: CounterpartyId,
    expectedVersion: Version,
    fields: CounterpartyFields,
  }),
  Schema.Struct({
    kind: Schema.Literal("merge"),
    sourceId: CounterpartyId,
    sourceVersion: Version,
    targetId: CounterpartyId,
    targetVersion: Version,
  }).check(
    Schema.makeFilter(
      (merge) => merge.sourceId !== merge.targetId || "Choose another counterparty to merge into.",
    ),
  ),
  // `event` is the transaction the move was chosen from, if any. It follows the
  // descriptor afterwards, even if you had moved it to another counterparty by hand.
  Schema.Struct({
    kind: Schema.Literal("moveAlias"),
    aliasKey: Schema.NonEmptyString,
    expectedVersion: Schema.NullOr(Version),
    counterpartyId: CounterpartyId,
    event: Schema.NullOr(ExpectedEventVersion),
  }),
  // Sets what payments with one counterparty and one reference are, ahead of the
  // counterparty's own default.
  Schema.Struct({
    kind: Schema.Literal("saveReference"),
    counterpartyId: CounterpartyId,
    referenceKey: Schema.NonEmptyString,
    expectedVersion: Schema.NullOr(Version),
    defaultRole: CounterpartyRole,
    defaultCategoryId: Schema.NullOr(CategoryId),
  }),
  Schema.Struct({
    kind: Schema.Literal("deleteReference"),
    counterpartyId: CounterpartyId,
    referenceKey: Schema.NonEmptyString,
    expectedVersion: Version,
  }),
]).pipe(Schema.toTaggedUnion("kind"));
export type CounterpartyChange = typeof CounterpartyChange.Type;
export const PreviewCounterpartyChange = Schema.Struct({ change: CounterpartyChange });
export const ApplyCounterpartyChange = Schema.Struct({
  commandId: CommandId,
  change: CounterpartyChange,
});
// A default category can move every transaction of a counterparty and leave each total
// as it was, so a preview also counts the transactions whose meaning changes. `event` is
// the transaction a descriptor move was chosen from, as the move leaves it.
export const CounterpartyChangePreview = Schema.Struct({
  change: CounterpartyChange,
  eventCount: Schema.Int,
  impacts: Schema.Array(MeasureImpact),
  event: Schema.NullOr(FinancialEvent),
});
export const ReinterpretPostings = Schema.Struct({ commandId: CommandId });
export const ReinterpretationSummary = Schema.Struct({
  descriptors: Schema.Int,
  created: Schema.Int,
  changed: Schema.Int,
});

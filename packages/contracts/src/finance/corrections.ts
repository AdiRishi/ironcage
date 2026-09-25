import { Schema } from "effect";

import { Allocation, FinancialEvent } from "./events.ts";
import { CounterpartyId, EventId, FinancialRole } from "./interpretation.ts";
import { CalendarDate, CommandId, Instant, Money, Version } from "./values.ts";

export const CorrectionId = Schema.String.check(Schema.isUUID()).pipe(Schema.brand("CorrectionId"));
export const EventChange = Schema.Struct({
  eventId: EventId,
  kind: FinancialRole,
  purchaseOn: Schema.NullOr(CalendarDate),
  allocations: Schema.NonEmptyArray(Allocation),
});
export type EventChange = typeof EventChange.Type;
export const ExpectedEventVersion = Schema.Struct({ eventId: EventId, version: Version });
export const PreviewCorrection = Schema.Struct({ change: EventChange });
export const ApplyCorrection = Schema.Struct({
  commandId: CommandId,
  change: EventChange,
  expectedVersions: Schema.NonEmptyArray(ExpectedEventVersion),
});
export const UndoCorrection = Schema.Struct({
  commandId: CommandId,
  correctionId: CorrectionId,
  expectedVersions: Schema.NonEmptyArray(ExpectedEventVersion),
});
export const PreviewUndoCorrection = Schema.Struct({ correctionId: CorrectionId });
// Names who is on the other side of one event. A null counterparty returns the event to
// the counterparty its descriptor names.
export const AssignEventCounterparty = Schema.Struct({
  commandId: CommandId,
  eventId: EventId,
  counterpartyId: Schema.NullOr(CounterpartyId),
  expectedVersions: Schema.NonEmptyArray(ExpectedEventVersion),
});
export const PreviewEventCounterparty = Schema.Struct({
  eventId: EventId,
  counterpartyId: Schema.NullOr(CounterpartyId),
});
// `change` says what a correction set: the role, purchase date, and allocations, or the
// counterparty. An undo restores the same part.
export const Correction = Schema.Struct({
  id: CorrectionId,
  eventId: EventId,
  commandId: CommandId,
  prior: FinancialEvent,
  accepted: FinancialEvent,
  action: Schema.Literals(["correct", "undo"]),
  change: Schema.Literals(["allocations", "counterparty"]),
  createdAt: Instant,
});
// A period's flow totals, as the overview computes them from ledger facts.
export const PeriodMeasures = Schema.Struct({
  inflow: Money,
  outflow: Money,
  spending: Money,
  income: Money,
  internal: Money,
  loanPrincipal: Money,
  unresolvedOut: Money,
  unresolvedIn: Money,
  modelShare: Money,
});
// One calendar month of spending dates that a change touches, before and after it.
export const MeasureImpact = Schema.Struct({
  start: CalendarDate,
  endExclusive: CalendarDate,
  basis: Schema.Literal("spending"),
  currency: Schema.String,
  calculatedAt: Instant,
  before: PeriodMeasures,
  after: PeriodMeasures,
});
export const CorrectionPreview = Schema.Struct({
  change: EventChange,
  expectedVersions: Schema.NonEmptyArray(ExpectedEventVersion),
  impacts: Schema.Array(MeasureImpact),
});
// An event as a change would leave it, with the version the change expects.
export const EventPreview = Schema.Struct({
  after: FinancialEvent,
  expectedVersions: Schema.NonEmptyArray(ExpectedEventVersion),
  impacts: Schema.Array(MeasureImpact),
});

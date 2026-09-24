import { Schema } from "effect";

import { Allocation, FinancialEvent } from "./events.ts";
import { EventId, FinancialRole } from "./interpretation.ts";
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
export const Correction = Schema.Struct({
  id: CorrectionId,
  eventId: EventId,
  commandId: CommandId,
  prior: FinancialEvent,
  accepted: FinancialEvent,
  scope: Schema.String,
  createdAt: Instant,
});
export const CorrectionHistory = Schema.Array(Correction);
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

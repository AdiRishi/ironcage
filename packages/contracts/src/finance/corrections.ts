import { Schema } from "effect";

import { Allocation, FinancialEvent } from "./events.ts";
import { EventId, FinancialRole } from "./interpretation.ts";
import { AccountId, CalendarDate, CommandId, Instant, Money, Version } from "./values.ts";

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
export const PeriodMeasures = Schema.Struct({
  grossCosts: Money,
  netPersonalCosts: Money,
  income: Money,
  cashChange: Schema.NullOr(Money),
  observedCashMovement: Money,
  loanRepayments: Money,
  financingCosts: Money,
  netPrincipalReduction: Schema.NullOr(Money),
  unresolvedCount: Schema.Int,
});
export const MeasureImpact = Schema.Struct({
  start: CalendarDate,
  endExclusive: CalendarDate,
  basis: Schema.Literal("posted"),
  currency: Schema.String,
  accountIds: Schema.Array(AccountId),
  calculatedAt: Instant,
  before: PeriodMeasures,
  after: PeriodMeasures,
});
export const CorrectionPreview = Schema.Struct({
  change: EventChange,
  expectedVersions: Schema.NonEmptyArray(ExpectedEventVersion),
  impact: MeasureImpact,
});

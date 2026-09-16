import {
  AccountId,
  AllocationId,
  type CreditLink,
  CalendarDate,
  EventId,
  FinancialRole,
  Money,
  PeriodMeasures,
  type FinancialEvent,
} from "@repo/contracts/finance";
import { DateTime, Schema } from "effect";

export const MeasureFact = Schema.Struct({
  eventId: EventId,
  allocationId: AllocationId,
  accountId: AccountId,
  postedOn: CalendarDate,
  kind: FinancialRole,
  role: FinancialRole,
  amount: Money,
  nonPersonal: Schema.Boolean,
});
export type MeasureFact = typeof MeasureFact.Type;
export function postedMonth(on: CalendarDate) {
  const start = CalendarDate.make(`${on.slice(0, 7)}-01`);
  return {
    start,
    endExclusive: CalendarDate.make(
      DateTime.formatIsoDateUtc(DateTime.add(DateTime.makeUnsafe(start), { months: 1 })),
    ),
  };
}
export function eventFacts(event: FinancialEvent): ReadonlyArray<MeasureFact> {
  const primary = event.postings.find((posting) => posting.id === event.primaryPostingId);
  return primary && event.active
    ? event.allocations.map((allocation) => ({
        eventId: event.id,
        allocationId: allocation.id,
        accountId: event.reportingAccountId,
        postedOn: primary.postedOn,
        kind: event.kind,
        role: allocation.role,
        amount: allocation.amount,
        nonPersonal: allocation.nonPersonal,
      }))
    : [];
}
export function periodMeasures({
  facts,
  currency,
  loanAccountIds,
  observedCashMovement,
  cashComplete,
  loanComplete,
  credits = [],
}: {
  facts: ReadonlyArray<MeasureFact>;
  credits?: ReadonlyArray<typeof CreditLink.Type>;
  currency: string;
  loanAccountIds: ReadonlyArray<typeof AccountId.Type>;
  observedCashMovement: bigint;
  cashComplete: boolean;
  loanComplete: boolean;
}): typeof PeriodMeasures.Type {
  let gross = 0n,
    net = 0n,
    income = 0n,
    repayments = 0n,
    financing = 0n;
  const unresolved = new Set<typeof EventId.Type>();
  for (const fact of facts) {
    const amounts = allocationMeasures(fact, credits);
    gross += amounts.gross;
    net += amounts.net;
    income += amounts.income;
    if (fact.kind === "unresolved") unresolved.add(fact.eventId);
    if (loanAccountIds.includes(fact.accountId)) {
      if (fact.kind === "loanPayment") repayments += fact.amount.minor;
      if (fact.kind === "financingCost") financing += fact.amount.minor;
    }
  }
  const money = (minor: bigint) => ({ currency, minor });
  return {
    grossCosts: money(gross),
    netPersonalCosts: money(net),
    income: money(income),
    cashChange: cashComplete ? money(observedCashMovement) : null,
    observedCashMovement: money(observedCashMovement),
    loanRepayments: money(repayments),
    financingCosts: money(financing),
    netPrincipalReduction:
      loanComplete &&
      !facts.some((fact) => loanAccountIds.includes(fact.accountId) && fact.kind === "unresolved")
        ? money(repayments - financing)
        : null,
    unresolvedCount: unresolved.size,
  };
}

export function allocationMeasures(
  fact: Pick<MeasureFact, "role" | "amount" | "nonPersonal" | "allocationId">,
  credits: ReadonlyArray<typeof CreditLink.Type>,
) {
  const gross = fact.role === "purchase" || fact.role === "financingCost" ? fact.amount.minor : 0n;
  const net = fact.nonPersonal
    ? 0n
    : gross -
      credits
        .filter((link) => link.costAllocationId === fact.allocationId)
        .reduce((sum, link) => sum + link.amount.minor, 0n);
  return { gross, net, income: fact.role === "income" ? fact.amount.minor : 0n };
}

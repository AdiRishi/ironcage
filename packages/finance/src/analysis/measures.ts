import type {
  Account,
  AccountCoverage,
  CalendarDate,
  CreditLink,
  FinancialEvent,
  OverviewInput,
  OverviewResult,
  Period,
  Posting,
  ReferenceData,
} from "@repo/contracts/finance";

import { eventFacts, periodMeasures } from "../impact.ts";
import { decimalRatio } from "./decimal.ts";
import { addDays, inPeriod, missingPeriods, mergePeriods } from "./periods.ts";

export type AnalysisSnapshot = {
  accounts: readonly Account[];
  events: readonly FinancialEvent[];
  credits: readonly (typeof CreditLink.Type)[];
  postings: readonly Posting[];
  sources: readonly {
    accountId: Account["id"];
    observedStart: CalendarDate | null;
    observedEnd: CalendarDate | null;
    openingOn: CalendarDate | null;
    closingOn: CalendarDate | null;
    reconciled: boolean;
  }[];
  imports: readonly { accountId: Account["id"]; at: string }[];
  references: typeof ReferenceData.Type;
};
export function eventDate(event: FinancialEvent, basis: OverviewInput["basis"]) {
  return basis === "spending" && event.kind === "purchase" && event.purchaseOn
    ? event.purchaseOn
    : event.postings.find((posting) => posting.id === event.primaryPostingId)?.postedOn;
}
export function accountCoverage(snapshot: AnalysisSnapshot, period: Period): AccountCoverage[] {
  return snapshot.accounts.map((account) => {
    const sources = snapshot.sources.filter((source) => source.accountId === account.id);
    const observed = sources.flatMap((source) =>
      source.observedStart && source.observedEnd
        ? [{ start: source.observedStart, endExclusive: addDays(source.observedEnd, 1) }]
        : [],
    );
    const reconciled = sources.flatMap((source) =>
      source.reconciled && source.openingOn && source.closingOn
        ? [{ start: source.openingOn, endExclusive: addDays(source.closingOn, 1) }]
        : [],
    );
    return {
      account,
      observed: mergePeriods(observed),
      reconciled: mergePeriods(reconciled),
      missing: missingPeriods(period, reconciled),
      latestImportAt: snapshot.imports.find((item) => item.accountId === account.id)?.at ?? null,
    };
  });
}
export function calculateOverview(
  snapshot: AnalysisSnapshot,
  input: OverviewInput,
  period: Period,
  calculatedAt: string,
): OverviewResult {
  const ids = snapshot.accounts.map((account) => account.id);
  const events = snapshot.events.filter(
    (event) => event.active && ids.includes(event.reportingAccountId),
  );
  const selected = events.filter((event) => {
    const on = eventDate(event, input.basis);
    return on !== undefined && inPeriod(on, period);
  });
  const facts = selected.flatMap(eventFacts);
  const coverage = accountCoverage(snapshot, period);
  const deposits = coverage.filter((item) => item.account.kind === "deposit");
  const cash = snapshot.postings
    .filter(
      (posting) =>
        deposits.some((item) => item.account.id === posting.accountId) &&
        inPeriod(posting.postedOn, period),
    )
    .reduce((sum, posting) => sum + posting.amount.minor, 0n);
  const measures = periodMeasures({
    facts,
    currency: input.currency,
    credits: snapshot.credits,
    loanAccountIds: [],
    observedCashMovement: cash,
    cashComplete: deposits.length > 0 && deposits.every((item) => item.missing.length === 0),
    loanComplete: false,
  });
  const money = (minor: bigint) => ({ currency: input.currency, minor });
  const surplus = measures.income.minor - measures.netPersonalCosts.minor;
  const unresolved = selected.filter((event) => event.kind === "unresolved");
  const unlinked = selected
    .flatMap((event) => event.allocations)
    .filter((allocation) => allocation.role === "refund" || allocation.role === "reimbursement")
    .reduce(
      (sum, allocation) =>
        sum +
        allocation.amount.minor -
        snapshot.credits
          .filter((link) => link.creditAllocationId === allocation.id)
          .reduce((applied, link) => applied + link.amount.minor, 0n),
      0n,
    );
  const loans = coverage
    .filter((item) => item.account.kind === "loan")
    .map((item) => {
      const loanEvents = events.filter((event) => event.reportingAccountId === item.account.id);
      const loanFacts = loanEvents.flatMap((event) => {
        const posting = event.postings.find((row) => row.accountId === item.account.id);
        return posting && inPeriod(posting.postedOn, period) ? eventFacts(event) : [];
      });
      const values = periodMeasures({
        facts: loanFacts,
        currency: input.currency,
        loanAccountIds: [item.account.id],
        observedCashMovement: 0n,
        cashComplete: false,
        loanComplete: item.missing.length === 0,
      });
      return {
        accountId: item.account.id,
        label: item.account.label,
        repayments: values.loanRepayments,
        financingCosts: values.financingCosts,
        netPrincipalReduction: values.netPrincipalReduction,
      };
    });
  return {
    period,
    basis: input.basis,
    currency: input.currency,
    accountIds: ids,
    calculatedAt,
    calculationVersion: "history-1",
    coverage: {
      accounts: coverage,
      unresolvedCount: unresolved.length,
      unresolvedAmount: money(unresolved.reduce((sum, event) => sum + event.magnitude.minor, 0n)),
      unlinkedCredits: money(unlinked),
    },
    grossCosts: measures.grossCosts,
    netPersonalCosts: measures.netPersonalCosts,
    income: measures.income,
    surplus: money(surplus),
    surplusRate:
      measures.income.minor > 0n ? decimalRatio(surplus * 100n, measures.income.minor) : null,
    cashBalanceChange: measures.cashChange,
    purchaseCount: new Set(
      selected.filter((event) => event.kind === "purchase").map((event) => event.id),
    ).size,
    loans,
  };
}

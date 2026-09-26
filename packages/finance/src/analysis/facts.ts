import type {
  AccountId,
  AccountKind,
  AllocationId,
  CalendarDate,
  CategoryId,
  Counterparty,
  CounterpartyId,
  CreditLink,
  EventId,
  FactMeasure,
  FinancialEvent,
  PostingId,
} from "@repo/contracts/finance";

export type LedgerFact = {
  eventId: typeof EventId.Type;
  allocationId: typeof AllocationId.Type | null;
  // The posting the money moved through, which dates the fact and names its account.
  postingId: typeof PostingId.Type;
  // The credit a linked reduction comes from. Its primary posting is the record behind
  // the reduction.
  creditEventId: typeof EventId.Type | null;
  accountId: typeof AccountId.Type;
  counterpartyId: typeof CounterpartyId.Type | null;
  categoryId: typeof CategoryId.Type | null;
  measure: FactMeasure;
  postedOn: CalendarDate;
  spendingOn: CalendarDate;
  currency: string;
  amountMinor: bigint;
  purchase: boolean;
  modelAssigned: boolean;
};

// Bump when eventLedgerFacts changes what it produces. Events whose facts were built
// by an older version are rebuilt in the background.
export const factsVersion = 3;

export type FactLink = Pick<
  typeof CreditLink.Type,
  "creditAllocationId" | "costAllocationId" | "amount" | "creditEventId"
>;

// Turns one event into what it contributes to each measure. Spending is positive for
// costs and negative for credits. A credit linked to a purchase reduces that purchase:
// the purchase's event emits the reduction in its own category and period, so the facts
// of an event depend only on its own rows and the links that touch it. The rest of a
// credit lands on its own date.
//
// Money moves through the event's posting outside loan accounts: the deposit side of a
// repayment or a drawdown. An event with no such posting moves money only within a loan,
// so a repayment or drawdown recorded on the loan alone is internal.
export function eventLedgerFacts({
  event,
  accountKinds,
  counterparty,
  links,
}: {
  event: FinancialEvent;
  accountKinds: ReadonlyMap<string, typeof AccountKind.Type>;
  counterparty: Pick<Counterparty, "source"> | null;
  links: readonly FactLink[];
}): LedgerFact[] {
  const primary = event.postings.find((posting) => posting.id === event.primaryPostingId);
  if (!event.active || !primary) return [];
  const outsideLoans = (posting: FinancialEvent["postings"][number]) =>
    accountKinds.get(posting.accountId) !== "loan";
  const cash = [primary, ...event.postings].find(outsideLoans);
  const posting = cash ?? primary;
  const base = {
    eventId: event.id,
    postingId: posting.id,
    creditEventId: null,
    accountId: posting.accountId,
    counterpartyId: event.counterpartyId,
    postedOn: posting.postedOn,
    spendingOn: event.kind === "purchase" && event.purchaseOn ? event.purchaseOn : posting.postedOn,
    currency: event.magnitude.currency,
    purchase: event.kind === "purchase",
  };

  return event.allocations.flatMap((allocation): LedgerFact[] => {
    const categoryId = allocation.categoryId;
    const fact = {
      ...base,
      allocationId: allocation.id,
      categoryId,
      modelAssigned:
        counterparty?.source === "model" &&
        (event.roleSource === "counterparty" || allocation.categorySource === "counterparty"),
    };
    const amount = allocation.amount.minor;
    switch (allocation.role) {
      case "purchase":
      case "financingCost":
        return allocation.nonPersonal
          ? []
          : [
              { ...fact, measure: "spending", amountMinor: amount },
              ...links
                .filter((link) => link.costAllocationId === allocation.id)
                .map((link): LedgerFact => ({
                  ...fact,
                  creditEventId: link.creditEventId,
                  measure: "spending",
                  amountMinor: -link.amount.minor,
                })),
            ];
      case "income":
        return [{ ...fact, measure: "income", amountMinor: amount }];
      case "refund":
      case "reimbursement": {
        const rest =
          amount -
          links
            .filter((link) => link.creditAllocationId === allocation.id)
            .reduce((sum, link) => sum + link.amount.minor, 0n);
        if (rest <= 0n) return [];
        return [
          categoryId
            ? { ...fact, measure: "spending", amountMinor: -rest }
            : { ...fact, measure: "unresolvedIn", amountMinor: rest },
        ];
      }
      case "transfer":
        if (event.kind === "loanPayment")
          return [{ ...fact, measure: cash ? "loanRepayment" : "internal", amountMinor: amount }];
        // Both sides of a pair are in the ledger. Bank structure reads a transfer only from
        // an own-account suffix that matches one of your ledger accounts (bankReading), so
        // the other side of a transfer it read is in the ledger even without its posting.
        if (
          event.kind === "cardSettlement" ||
          event.postings.length > 1 ||
          event.roleSource === "bank"
        )
          return [{ ...fact, measure: "internal", amountMinor: amount }];
        return [
          {
            ...fact,
            measure: posting.amount.minor < 0n ? "externalOut" : "externalIn",
            amountMinor: amount,
          },
        ];
      case "borrowing":
        return [{ ...fact, measure: cash ? "borrowing" : "internal", amountMinor: amount }];
      case "unresolved":
        return [
          {
            ...fact,
            measure: posting.amount.minor < 0n ? "unresolvedOut" : "unresolvedIn",
            amountMinor: amount,
          },
        ];
    }
  });
}

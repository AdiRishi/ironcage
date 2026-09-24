import type {
  AccountId,
  AccountKind,
  AllocationId,
  CalendarDate,
  CategoryId,
  CounterpartyId,
  CounterpartyKind,
  CreditLink,
  EventId,
  FinancialEvent,
} from "@repo/contracts/finance";

export type FactMeasure =
  | "spending"
  | "income"
  | "internal"
  | "externalOut"
  | "externalIn"
  | "loanRepayment"
  | "borrowing"
  | "unresolvedOut"
  | "unresolvedIn";

export type LedgerFact = {
  eventId: typeof EventId.Type;
  allocationId: typeof AllocationId.Type | null;
  accountId: typeof AccountId.Type;
  counterpartyId: typeof CounterpartyId.Type | null;
  categoryId: typeof CategoryId.Type | null;
  topCategoryId: typeof CategoryId.Type | null;
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
export const factsVersion = 2;

export type FactLink = Pick<
  typeof CreditLink.Type,
  "creditAllocationId" | "costAllocationId" | "amount"
>;

// Turns one event into what it contributes to each measure. Spending is positive for
// costs and negative for credits. A credit linked to a purchase reduces that purchase:
// the purchase's event emits the reduction in its own category and period, so the facts
// of an event depend only on its own rows and the links that touch it. The rest of a
// credit lands on its own date.
export function eventLedgerFacts({
  event,
  accountKinds,
  counterparty,
  links,
  topCategory,
}: {
  event: FinancialEvent;
  accountKinds: ReadonlyMap<string, typeof AccountKind.Type>;
  counterparty: { kind: CounterpartyKind; source: "user" | "model" } | null;
  links: readonly FactLink[];
  topCategory: (id: typeof CategoryId.Type) => typeof CategoryId.Type | null;
}): LedgerFact[] {
  const primary = event.postings.find((posting) => posting.id === event.primaryPostingId);
  if (!event.active || !primary) return [];
  const postedOn = primary.postedOn;
  const spendingOn = event.kind === "purchase" && event.purchaseOn ? event.purchaseOn : postedOn;
  const modelSource = counterparty?.source === "model";
  const base = {
    eventId: event.id,
    accountId: event.reportingAccountId,
    counterpartyId: event.counterpartyId,
    postedOn,
    spendingOn,
    currency: event.magnitude.currency,
    purchase: event.kind === "purchase",
  };
  const onlyLoan = event.postings.every(
    (posting) => accountKinds.get(posting.accountId) === "loan",
  );

  return event.allocations.flatMap((allocation): LedgerFact[] => {
    const categoryId = allocation.categoryId;
    const fact = {
      ...base,
      allocationId: allocation.id,
      categoryId,
      topCategoryId: categoryId ? topCategory(categoryId) : null,
      modelAssigned:
        modelSource &&
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
          return [
            { ...fact, measure: onlyLoan ? "internal" : "loanRepayment", amountMinor: amount },
          ];
        if (event.kind === "cardSettlement")
          return [{ ...fact, measure: "internal", amountMinor: amount }];
        if (counterparty?.kind === "ownAccount" && event.postings.length === 1)
          return [
            {
              ...fact,
              measure: primary.amount.minor < 0n ? "externalOut" : "externalIn",
              amountMinor: amount,
            },
          ];
        return [{ ...fact, measure: "internal", amountMinor: amount }];
      case "borrowing":
        return [
          {
            ...fact,
            measure: event.postings.some(
              (posting) => accountKinds.get(posting.accountId) === "loan",
            )
              ? "borrowing"
              : "internal",
            amountMinor: amount,
          },
        ];
      case "unresolved":
        return [
          {
            ...fact,
            measure: primary.amount.minor < 0n ? "unresolvedOut" : "unresolvedIn",
            amountMinor: amount,
          },
        ];
    }
  });
}

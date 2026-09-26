import type {
  AllocationId,
  CalendarDate,
  CounterpartyId,
  EventId,
  Money,
} from "@repo/contracts/finance";

import { addDays } from "./dates.ts";

export type CreditSide = {
  eventId: typeof EventId.Type;
  allocationId: typeof AllocationId.Type;
  kind: "refund" | "reimbursement";
  counterpartyId: typeof CounterpartyId.Type | null;
  aliasKey: string | null;
  reference: string | null;
  postedOn: CalendarDate;
  remaining: Money;
};
export type CostSide = {
  eventId: typeof EventId.Type;
  allocationId: typeof AllocationId.Type;
  counterpartyId: typeof CounterpartyId.Type | null;
  aliasKey: string | null;
  description: string;
  spendingOn: CalendarDate;
  remaining: Money;
};
export type CreditProposal = {
  creditEventId: typeof EventId.Type;
  costEventId: typeof EventId.Type;
  creditAllocationId: typeof AllocationId.Type;
  costAllocationId: typeof AllocationId.Type;
  amount: Money;
};

// A business usually refunds within a few months; a person repays within a fortnight.
const refundWindowDays = 120;
const repaymentWindowDays = 14;
const words = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((word) => word.length >= 4),
  );

// Which purchase each credit most likely returns, proposed only when one purchase is the
// clear answer. A refund returns a purchase from the same counterparty or descriptor,
// preferring the one with exactly its amount. A repayment from a person returns a
// recent larger purchase whose description shares a word with the transfer's reference,
// such as "dinner". Amount and date alone never propose a link.
export function creditProposals({
  credits,
  costs,
}: {
  credits: readonly CreditSide[];
  costs: readonly CostSide[];
}): CreditProposal[] {
  return credits.flatMap((credit) => {
    const window = credit.kind === "refund" ? refundWindowDays : repaymentWindowDays;
    const recent = costs.filter(
      (cost) =>
        cost.remaining.currency === credit.remaining.currency &&
        cost.spendingOn <= credit.postedOn &&
        cost.spendingOn >= addDays(credit.postedOn, -window),
    );
    const candidates =
      credit.kind === "refund"
        ? recent.filter(
            (cost) =>
              cost.remaining.minor >= credit.remaining.minor &&
              ((credit.counterpartyId !== null && cost.counterpartyId === credit.counterpartyId) ||
                (credit.aliasKey !== null && cost.aliasKey === credit.aliasKey)),
          )
        : recent.filter((cost) => {
            const reference = words(credit.reference ?? "");
            return (
              cost.remaining.minor > credit.remaining.minor &&
              [...words(cost.description)].some((word) => reference.has(word))
            );
          });
    const exact = candidates.filter((cost) => cost.remaining.minor === credit.remaining.minor);
    const [chosen] = exact.length === 1 ? exact : candidates.length === 1 ? candidates : [];
    return chosen
      ? [
          {
            creditEventId: credit.eventId,
            costEventId: chosen.eventId,
            creditAllocationId: credit.allocationId,
            costAllocationId: chosen.allocationId,
            amount: credit.remaining,
          },
        ]
      : [];
  });
}

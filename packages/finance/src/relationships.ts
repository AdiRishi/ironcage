import {
  type CreditLink,
  type FinancialEvent,
  FinanceError,
  type Endpoint,
  type MovementKind,
} from "@repo/contracts/finance";
import { Effect } from "effect";

import { allocationRole, isCost } from "./events.ts";

export function remainingAllocation(
  event: FinancialEvent,
  allocationId: FinancialEvent["allocations"][number]["id"],
  credits: ReadonlyArray<typeof CreditLink.Type>,
) {
  const allocation = event.allocations.find((row) => row.id === allocationId);
  return allocation
    ? allocation.amount.minor -
        credits
          .filter(
            (link) =>
              link.creditAllocationId === allocationId || link.costAllocationId === allocationId,
          )
          .reduce((sum, link) => sum + link.amount.minor, 0n)
    : 0n;
}
export const validateCredit = Effect.fn("validateCredit")(function* ({
  credit,
  cost,
  creditAllocationId,
  costAllocationId,
  amount,
  links,
}: {
  credit: FinancialEvent;
  cost: FinancialEvent;
  creditAllocationId: (typeof CreditLink.Type)["creditAllocationId"];
  costAllocationId: (typeof CreditLink.Type)["costAllocationId"];
  amount: (typeof CreditLink.Type)["amount"];
  links: ReadonlyArray<typeof CreditLink.Type>;
}) {
  const from = credit.allocations.find((row) => row.id === creditAllocationId);
  const to = cost.allocations.find((row) => row.id === costAllocationId);
  if (
    !credit.active ||
    !cost.active ||
    !from ||
    !to ||
    !(from.role === "refund" || from.role === "reimbursement") ||
    !isCost(to.role) ||
    credit.id === cost.id
  )
    return yield* new FinanceError({
      kind: "conflict",
      message:
        "Apply a refund or reimbursement allocation to a separate purchase or financing cost.",
    });
  if (
    amount.currency !== credit.magnitude.currency ||
    amount.currency !== cost.magnitude.currency ||
    amount.minor <= 0n
  )
    return yield* new FinanceError({
      kind: "conflict",
      message: "The credit must be positive and in the same currency as the cost.",
    });
  if (
    amount.minor > remainingAllocation(credit, creditAllocationId, links) ||
    amount.minor > remainingAllocation(cost, costAllocationId, links)
  )
    return yield* new FinanceError({
      kind: "conflict",
      message: "The amount exceeds the remaining credit or uncredited cost.",
    });
});
export const joinedMovement = Effect.fn("joinedMovement")(function* ({
  event,
  counterpart,
  kind,
  reportingAccountId,
}: {
  event: FinancialEvent;
  counterpart: FinancialEvent | null;
  kind: typeof MovementKind.Type;
  reportingAccountId: FinancialEvent["reportingAccountId"];
}) {
  if (
    !event.active ||
    event.postings.length !== 1 ||
    event.allocations.length !== 1 ||
    (counterpart &&
      (!counterpart.active ||
        counterpart.postings.length !== 1 ||
        counterpart.allocations.length !== 1 ||
        counterpart.id === event.id))
  )
    return yield* new FinanceError({
      kind: "conflict",
      message: "Choose two separate, unsplit events that are not already linked.",
    });
  const posting = event.postings[0];
  const other = counterpart?.postings[0];
  if (!posting)
    return yield* new FinanceError({ kind: "conflict", message: "A movement needs a posting." });
  if (
    other &&
    (posting.accountId === other.accountId ||
      posting.amount.currency !== other.amount.currency ||
      posting.amount.minor + other.amount.minor !== 0n)
  )
    return yield* new FinanceError({
      kind: "conflict",
      message: "Counterparts need equal opposite amounts in one currency on different accounts.",
    });
  const primary = other?.accountId === reportingAccountId ? other : posting;
  return {
    ...event,
    kind,
    primaryPostingId: primary.id,
    reportingAccountId,
    purchaseOn: null,
    version: event.version + 1,
    postings: other ? [posting, other] : [posting],
    allocations: [
      {
        ...event.allocations[0],
        role: allocationRole(kind),
        categoryId: null,
        merchantId: null,
        nonPersonal: false,
      },
    ],
  } satisfies FinancialEvent;
});
export function movementEndpoints(
  posting: FinancialEvent["postings"][number],
  counterpart: typeof Endpoint.Type,
) {
  const owned = { kind: "account", accountId: posting.accountId } satisfies typeof Endpoint.Type;
  return posting.amount.minor < 0n
    ? { from: owned, to: counterpart }
    : { from: counterpart, to: owned };
}

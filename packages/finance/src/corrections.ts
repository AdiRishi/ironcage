import { type EventChange, type FinancialEvent, FinanceError } from "@repo/contracts/finance";
import { Effect } from "effect";

import { allocationRole } from "./events.ts";

export const correctEvent = Effect.fn("correctEvent")(function* (
  event: FinancialEvent,
  change: EventChange,
) {
  if (!event.active)
    return yield* new FinanceError({
      kind: "conflict",
      message: "This event was joined to another event. Open its active interpretation.",
    });
  if (
    change.allocations.some(
      (allocation) =>
        allocation.amount.currency !== event.magnitude.currency || allocation.amount.minor < 0n,
    ) ||
    change.allocations.reduce((sum, allocation) => sum + allocation.amount.minor, 0n) !==
      event.magnitude.minor
  )
    return yield* new FinanceError({
      kind: "conflict",
      message:
        "Allocations must be nonnegative and sum exactly to the booked magnitude in its currency.",
    });
  if (
    new Set(change.allocations.map((allocation) => allocation.id)).size !==
    change.allocations.length
  )
    return yield* new FinanceError({
      kind: "invalid",
      message: "Each allocation must have its own ID.",
    });
  if (change.allocations.some((allocation) => allocation.role !== allocationRole(change.kind)))
    return yield* new FinanceError({
      kind: "conflict",
      message: "Allocation roles must agree with the financial event.",
    });
  if (change.allocations.length > 1 && change.kind !== "purchase")
    return yield* new FinanceError({ kind: "conflict", message: "Only purchases can be split." });
  const primary = event.postings.find((posting) => posting.id === event.primaryPostingId);
  if (!primary)
    return yield* new FinanceError({
      kind: "conflict",
      message: "The event has no primary posting.",
    });
  if (
    ((change.kind === "purchase" || change.kind === "financingCost") &&
      primary.amount.minor >= 0n) ||
    (["income", "refund", "reimbursement"].includes(change.kind) && primary.amount.minor <= 0n)
  )
    return yield* new FinanceError({
      kind: "conflict",
      message:
        "Purchases and costs need a debit; income, refunds, and reimbursements need a credit.",
    });
  if (event.postings.length > 1 && change.kind !== event.kind)
    return yield* new FinanceError({
      kind: "conflict",
      message: "Unlink this movement before changing its financial role.",
    });
  if (change.purchaseOn && change.kind !== "purchase")
    return yield* new FinanceError({
      kind: "invalid",
      message: "Only purchases have a purchase date.",
    });
  return {
    ...event,
    kind: change.kind,
    purchaseOn: change.purchaseOn,
    allocations: change.allocations,
    version: event.version + 1,
  };
});

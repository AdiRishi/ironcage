import {
  type CounterpartyId,
  type EventChange,
  type FinancialEvent,
  FinanceError,
  type RuleAction,
  type TransactionPatch,
} from "@repo/contracts/finance";
import { Array as Arr, Effect, Result } from "effect";

import { allocationRole } from "./events.ts";

const checkActive = Effect.fn("checkActive")(function* (event: FinancialEvent) {
  if (!event.active)
    return yield* new FinanceError({
      kind: "conflict",
      message: "This event was joined to another event. Open its active interpretation.",
    });
});

const checkEventChange = Effect.fn("checkEventChange")(function* (
  event: FinancialEvent,
  change: Pick<EventChange, "kind" | "purchaseOn" | "allocations">,
) {
  yield* checkActive(event);
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
});

// Only the values a correction changes become yours, and the rest keep following rules and
// defaults. A value the event's rules dispute also becomes yours as the correction leaves
// it, because correcting the event chooses it.
export const correctEvent = Effect.fn("correctEvent")(function* (
  event: FinancialEvent,
  change: EventChange,
  disputed: readonly (typeof RuleAction.Type)["kind"][],
) {
  yield* checkEventChange(event, change);
  const split = change.allocations.length > 1 || event.allocations.length > 1;
  return {
    ...event,
    kind: change.kind,
    roleSource:
      change.kind === event.kind && !disputed.includes("role") ? event.roleSource : "user",
    purchaseOn: change.purchaseOn,
    allocations: Arr.map(change.allocations, (allocation) => {
      const prior = event.allocations.find((row) => row.id === allocation.id);
      return {
        ...allocation,
        categorySource:
          split || disputed.includes("category") || prior?.categoryId !== allocation.categoryId
            ? allocation.categoryId === null
              ? null
              : "user"
            : (prior?.categorySource ?? null),
      };
    }),
    version: event.version + 1,
  };
});

const relabel = <Id extends string>(
  ids: ReadonlyArray<Id>,
  add: ReadonlyArray<Id> = [],
  remove: ReadonlyArray<Id> = [],
) => Arr.dedupe([...Arr.difference(ids, remove), ...add]);

// The change that sets what a patch names on a transaction that is not split and keeps
// everything else, the amount included. Its one allocation takes the role the event's
// role gives it. A split's parts change together, in the editor.
export function patchEvent(
  event: FinancialEvent,
  patch: TransactionPatch,
): Result.Result<EventChange, FinanceError> {
  const [allocation, ...others] = event.allocations;
  if (others.length > 0)
    return Result.fail(
      new FinanceError({ kind: "conflict", message: "Open the transaction to change a split." }),
    );
  const kind = patch.role ?? event.kind;
  return Result.succeed({
    eventId: event.id,
    kind,
    purchaseOn: patch.purchaseOn === undefined ? event.purchaseOn : patch.purchaseOn,
    allocations: [
      {
        ...allocation,
        role: allocationRole(kind),
        categoryId: patch.categoryId === undefined ? allocation.categoryId : patch.categoryId,
        nonPersonal: patch.nonPersonal ?? allocation.nonPersonal,
        tagIds: relabel(allocation.tagIds, patch.addTagIds, patch.removeTagIds),
        personalEventIds: relabel(
          allocation.personalEventIds,
          patch.addPersonalEventIds,
          patch.removePersonalEventIds,
        ),
      },
    ],
  });
}

// Returns an event's role, purchase date, and allocations to what they were before a
// correction, with the sources they had then, so only values you set stay yours. A
// movement link fixes the role only while the link exists.
export const restoreEvent = Effect.fn("restoreEvent")(function* (
  current: FinancialEvent,
  prior: FinancialEvent,
) {
  yield* checkEventChange(current, prior);
  return {
    ...current,
    kind: prior.kind,
    roleSource:
      current.roleSource === "link"
        ? "link"
        : prior.roleSource === "link"
          ? null
          : prior.roleSource,
    purchaseOn: prior.purchaseOn,
    allocations: prior.allocations,
    version: current.version + 1,
  } satisfies FinancialEvent;
});

// A null counterparty returns the event to the counterparty its descriptor names.
export const assignCounterparty = Effect.fn("assignCounterparty")(function* (
  event: FinancialEvent,
  counterpartyId: typeof CounterpartyId.Type | null,
) {
  yield* checkActive(event);
  return {
    ...event,
    counterpartyId,
    counterpartySource: counterpartyId === null ? null : "user",
    version: event.version + 1,
  } satisfies FinancialEvent;
});

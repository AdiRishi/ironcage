import { PgClient } from "@effect/sql-pg";
import {
  AccountId,
  AccountKind,
  CreditLinkId,
  FinancialEvent,
  FinanceError,
  type RelationshipChange,
} from "@repo/contracts/finance";
import { joinedMovement, movementEndpoints, validateCredit } from "@repo/finance";
import { Crypto, Effect, Schema } from "effect";

import { writeEvent } from "../events/correction-records.ts";
import { readEvent } from "../events/repository.ts";
import { allocationEvent, readCredits, readFees, readMovement } from "./repository.ts";

const conflict = (message: string) => new FinanceError({ kind: "conflict", message });
export const planRelationship = Effect.fn("planRelationship")(function* (
  change: RelationshipChange,
) {
  const sql = yield* PgClient.PgClient;
  const crypto = yield* Crypto.Crypto;
  const credits = yield* readCredits();
  const bump = (event: FinancialEvent): FinancialEvent => ({
    ...event,
    version: event.version + 1,
  });
  const touch = (events: readonly FinancialEvent[]) =>
    Effect.forEach(
      events,
      (event) => sql`UPDATE events SET version=${event.version} WHERE id=${event.id}`,
    );
  switch (change.kind) {
    case "linkMovement": {
      const event = yield* readEvent(change.eventId);
      const other =
        change.counterpart.kind === "event" ? yield* readEvent(change.counterpart.eventId) : null;
      const before: readonly [FinancialEvent, ...FinancialEvent[]] = other
        ? [event, other]
        : [event];
      for (const item of before) {
        if (
          (yield* readMovement(item.id)) ||
          (yield* readFees(item.id)).length ||
          credits.some((link) => link.creditEventId === item.id || link.costEventId === item.id)
        )
          return yield* conflict("Remove existing relationships before linking a movement.");
      }
      const posting = event.postings[0];
      if (!posting) return yield* conflict("A movement needs a posting.");
      const otherPosting = other?.postings[0];
      const endpoint =
        change.counterpart.kind === "event"
          ? otherPosting
            ? { kind: "account" as const, accountId: otherPosting.accountId }
            : null
          : change.counterpart;
      if (!endpoint) return yield* conflict("The counterpart has no posting.");
      if (endpoint.kind === "account" && endpoint.accountId === posting.accountId)
        return yield* conflict("Choose a different account.");
      const accountIds = [
        posting.accountId,
        ...(endpoint.kind === "account" ? [endpoint.accountId] : []),
      ];
      const accounts =
        yield* sql`SELECT id,kind FROM accounts WHERE ${sql.in("id", accountIds)} AND currency=${event.magnitude.currency}`.pipe(
          Effect.flatMap(
            Schema.decodeUnknownEffect(
              Schema.Array(Schema.Struct({ id: AccountId, kind: AccountKind })),
            ),
          ),
        );
      if (accounts.length !== accountIds.length)
        return yield* conflict("Choose an account in the same currency.");
      const endpoints = movementEndpoints(posting, endpoint);
      const loan = accounts.find((account) => account.kind === "loan");
      const card = accounts.find((account) => account.kind === "card");
      if ((change.movementKind === "loanPayment" || change.movementKind === "borrowing") && !loan)
        return yield* conflict("A loan movement needs a loan account.");
      if (change.movementKind === "cardSettlement" && !card)
        return yield* conflict("A card settlement needs a card account.");
      const receiver = endpoints.to.kind === "account" ? endpoints.to.accountId : null;
      const sender = endpoints.from.kind === "account" ? endpoints.from.accountId : null;
      if (
        (change.movementKind === "loanPayment" && receiver !== loan?.id) ||
        (change.movementKind === "borrowing" && sender !== loan?.id) ||
        (change.movementKind === "cardSettlement" && receiver !== card?.id)
      )
        return yield* conflict("The posting direction does not match this movement role.");
      // A missing loan-side posting cannot establish an observed loan repayment.
      const reportingAccountId =
        change.movementKind === "loanPayment" || change.movementKind === "borrowing"
          ? (before.flatMap((item) => item.postings).find((item) => item.accountId === loan?.id)
              ?.accountId ?? posting.accountId)
          : change.movementKind === "cardSettlement"
            ? (accounts.find((account) => account.kind === "deposit")?.id ?? posting.accountId)
            : (sender ?? posting.accountId);
      const accepted = yield* joinedMovement({
        event,
        counterpart: other,
        kind: change.movementKind,
        reportingAccountId,
      });
      const after: readonly FinancialEvent[] = other
        ? [accepted, { ...bump(other), active: false }]
        : [accepted];
      const execute = Effect.gen(function* () {
        if (other) {
          yield* sql`UPDATE events SET active=false,version=version+1 WHERE id=${other.id}`;
          yield* sql`UPDATE event_postings SET active=false WHERE event_id=${other.id}`;
        }
        yield* writeEvent(accepted);
        if (otherPosting)
          yield* sql`INSERT INTO event_postings(event_id,posting_id,active) VALUES (${event.id},${otherPosting.id},true)`;
        yield* sql`INSERT INTO movement_links(event_id,from_endpoint,to_endpoint,evidence,original_event,absorbed_event_id) VALUES (${event.id},${sql.json(endpoints.from)},${sql.json(endpoints.to)},'[]',${sql.json(yield* Schema.encodeEffect(Schema.toCodecJson(FinancialEvent))(event))},${other?.id ?? null})`;
      });
      return { before, after, credits: { before: credits, after: credits }, execute };
    }
    case "unlinkMovement": {
      const event = yield* readEvent(change.eventId);
      const link = yield* readMovement(event.id);
      if (!link) return yield* conflict("This event has no movement link.");
      const other = link.absorbedEventId ? yield* readEvent(link.absorbedEventId) : null;
      const before: readonly [FinancialEvent, ...FinancialEvent[]] = other
        ? [event, other]
        : [event];
      const restored = { ...link.original, version: event.version + 1 };
      const after = other ? [restored, { ...bump(other), active: true }] : [restored];
      const execute = Effect.gen(function* () {
        yield* sql`DELETE FROM movement_links WHERE event_id=${event.id}`;
        yield* sql`DELETE FROM event_postings WHERE event_id=${event.id} AND posting_id<>${restored.primaryPostingId}`;
        yield* writeEvent(restored);
        if (other) {
          yield* sql`UPDATE events SET active=true,version=version+1 WHERE id=${other.id}`;
          yield* sql`UPDATE event_postings SET active=true WHERE event_id=${other.id}`;
        }
      });
      return { before, after, credits: { before: credits, after: credits }, execute };
    }
    case "linkCredit": {
      const credit = yield* allocationEvent(change.creditAllocationId);
      const cost = yield* allocationEvent(change.costAllocationId);
      yield* validateCredit({ ...change, credit, cost, links: credits });
      const link = {
        ...change,
        id: CreditLinkId.make(yield* crypto.randomUUIDv4),
        creditEventId: credit.id,
        costEventId: cost.id,
      };
      const before: readonly [FinancialEvent, ...FinancialEvent[]] = [credit, cost];
      const after = before.map(bump);
      const execute = Effect.gen(function* () {
        yield* sql`INSERT INTO credit_links(id,credit_allocation_id,cost_allocation_id,amount_minor) VALUES (${link.id},${link.creditAllocationId},${link.costAllocationId},${link.amount.minor.toString()})`;
        yield* touch(after);
      });
      return { before, after, credits: { before: credits, after: [...credits, link] }, execute };
    }
    case "unlinkCredit": {
      const link = credits.find((item) => item.id === change.creditLinkId);
      if (!link) return yield* conflict("This credit link no longer exists.");
      const before: readonly [FinancialEvent, ...FinancialEvent[]] = [
        yield* readEvent(link.creditEventId),
        yield* readEvent(link.costEventId),
      ];
      const after = before.map(bump);
      const execute = Effect.gen(function* () {
        yield* sql`DELETE FROM credit_links WHERE id=${link.id}`;
        yield* touch(after);
      });
      return {
        before,
        after,
        credits: { before: credits, after: credits.filter((item) => item.id !== link.id) },
        execute,
      };
    }
    case "associateFee":
    case "removeFee": {
      const fee = yield* readEvent(change.feeEventId);
      const existing = (yield* readFees(fee.id)).find((link) => link.feeEventId === fee.id);
      const purchaseId =
        change.kind === "associateFee" ? change.purchaseEventId : existing?.purchaseEventId;
      if (!purchaseId) return yield* conflict("This fee has no association.");
      if (existing && existing.purchaseEventId !== purchaseId)
        return yield* conflict("Remove the existing fee association first.");
      const purchase = yield* readEvent(purchaseId);
      if (
        !fee.active ||
        !purchase.active ||
        fee.kind !== "financingCost" ||
        purchase.kind !== "purchase" ||
        fee.magnitude.currency !== purchase.magnitude.currency
      )
        return yield* conflict("Associate a financing cost with a purchase in the same currency.");
      const before: readonly [FinancialEvent, ...FinancialEvent[]] = [fee, purchase];
      const after = before.map(bump);
      const execute = Effect.gen(function* () {
        if (change.kind === "removeFee")
          yield* sql`DELETE FROM fee_associations WHERE fee_event_id=${fee.id}`;
        else
          yield* sql`INSERT INTO fee_associations(fee_event_id,purchase_event_id,status) VALUES (${fee.id},${purchase.id},${change.status}) ON CONFLICT(fee_event_id) DO UPDATE SET status=EXCLUDED.status`;
        yield* touch(after);
      });
      return { before, after, credits: { before: credits, after: credits }, execute };
    }
  }
});

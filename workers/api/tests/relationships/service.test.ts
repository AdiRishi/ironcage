import {
  AccountPeriodId,
  CalendarDate,
  CommandId,
  type Account,
  type FinancialEvent,
  type RelationshipChange,
} from "@repo/contracts/finance";
import { Crypto, Effect } from "effect";
import { expect } from "vitest";

import { AccountHistory } from "../../src/accounts/periods.ts";
import { Accounts } from "../../src/accounts/service.ts";
import { Corrections } from "../../src/events/corrections.ts";
import { Events } from "../../src/events/service.ts";
import { Publication } from "../../src/imports/publication.ts";
import { Postings } from "../../src/postings/service.ts";
import { InterpretationReviews } from "../../src/relationships/reviews.ts";
import { Relationships } from "../../src/relationships/service.ts";
import { applicationTest } from "../support/application.ts";
import { parsed, reset, source } from "../support/fixtures.ts";
const { test, services } = applicationTest();
const uuid = Crypto.Crypto.use((crypto) => crypto.randomUUIDv4);
const commandId = uuid.pipe(Effect.map((id) => CommandId.make(id)));
const createAccount = Effect.fn(function* (kind: Account["kind"], label: string) {
  const accounts = yield* Accounts;
  return yield* accounts.create({ commandId: yield* commandId, kind, label, currency: "AUD" });
});
const createEvents = Effect.fn(function* (
  owner: Account,
  rows: readonly { description: string; minor: bigint; on?: string }[],
) {
  const file = yield* source(owner.id);
  const data = parsed(rows.map((row) => row.description));
  const publication = yield* Publication;
  yield* publication.publish({
    ...data,
    importId: file.importId,
    observations: data.observations.map((observation, index) => {
      const row = rows[index];
      if (!row || !observation.candidate) throw new Error("Expected fixture row");
      return {
        ...observation,
        candidate: {
          ...observation.candidate,
          amount: { currency: "AUD", minor: row.minor },
          postedOn: CalendarDate.make(row.on ?? "2026-09-01"),
        },
      };
    }),
  });
  const events = yield* Events;
  yield* events.interpret({ commandId: yield* commandId });
  const postings = yield* Postings;
  return yield* Effect.forEach(
    (yield* postings.list({ filter: { importId: file.importId } })).rows,
    (posting) =>
      Effect.gen(function* () {
        const event = yield* events.forPosting({ postingId: posting.id });
        if (!event) return yield* Effect.die("Expected event");
        return event;
      }),
  );
});
const find = (events: readonly FinancialEvent[], description: string) => {
  const event = events.find((event) =>
    event.postings.some((posting) => posting.description === description),
  );
  if (!event) throw new Error("Expected synthetic event");
  return event;
};
const apply = Effect.fn(function* (change: RelationshipChange) {
  const relationships = yield* Relationships;
  const preview = yield* relationships.preview({ change });
  yield* relationships.apply({
    commandId: yield* commandId,
    change,
    expectedVersions: preview.expectedVersions,
  });
  return preview;
});

test(
  "card settlements count once, retain bank evidence, and unlink restores both events",
  Effect.gen(function* () {
    yield* reset;
    const deposit = yield* createAccount("deposit", "Cash");
    const card = yield* createAccount("card", "Card");
    const [debit] = yield* createEvents(deposit, [
      { description: "Transfer to card", minor: -10000n },
    ]);
    const rows = yield* createEvents(card, [
      { description: "Groceries Card xx1234", minor: -10000n },
      { description: "Payment received", minor: 10000n },
    ]);
    if (!debit) return yield* Effect.die("Expected debit");
    const credit = find(rows, "Payment received");
    const reviews = yield* InterpretationReviews;
    expect(
      (yield* reviews.list({})).rows.some(
        (row) => row.eventIds.includes(debit.id) && row.eventIds.includes(credit.id),
      ),
    ).toBe(true);
    const preview = yield* apply({
      kind: "linkMovement",
      eventId: debit.id,
      movementKind: "cardSettlement",
      counterpart: { kind: "event", eventId: credit.id },
    });
    expect(preview.impacts[0]?.after.grossCosts.minor).toBe(10000n);
    expect(preview.impacts[0]?.after.observedCashMovement.minor).toBe(-10000n);
    const events = yield* Events;
    const linked = yield* events.get({ eventId: debit.id });
    expect(
      linked.postings
        .map((posting) => posting.amount.minor)
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    ).toEqual([-10000n, 10000n]);
    expect(linked.magnitude.minor).toBe(10000n);
    expect((yield* events.forPosting({ postingId: credit.primaryPostingId }))?.id).toBe(debit.id);
    yield* apply({ kind: "unlinkMovement", eventId: debit.id });
    expect((yield* events.forPosting({ postingId: credit.primaryPostingId }))?.id).toBe(credit.id);
    expect((yield* events.get({ eventId: debit.id })).postings).toEqual(debit.postings);
  }).pipe(Effect.provide(services)),
);

test(
  "competing reimbursements cannot consume the same remaining cost and a later credit reduces the cost period",
  Effect.gen(function* () {
    yield* reset;
    const owner = yield* createAccount("deposit", "Cash");
    const rows = yield* createEvents(owner, [
      { description: "Dinner Card xx1234", minor: -30000n },
      { description: "Friend one", minor: 20000n, on: "2026-10-01" },
      { description: "Friend two", minor: 20000n, on: "2026-10-02" },
    ]);
    const dinner = find(rows, "Dinner Card xx1234");
    const corrections = yield* Corrections;
    const credits = yield* Effect.forEach(
      [find(rows, "Friend one"), find(rows, "Friend two")],
      (event) =>
        corrections.apply({
          commandId: CommandId.make(crypto.randomUUID()),
          expectedVersions: [{ eventId: event.id, version: event.version }],
          change: {
            eventId: event.id,
            kind: "reimbursement",
            purchaseOn: null,
            allocations: [{ ...event.allocations[0], role: "reimbursement" }],
          },
        }),
    );
    const relationships = yield* Relationships;
    const inputs = yield* Effect.forEach(credits, (event) =>
      Effect.gen(function* () {
        const change = {
          kind: "linkCredit",
          creditAllocationId: event.allocations[0].id,
          costAllocationId: dinner.allocations[0].id,
          amount: { currency: "AUD", minor: 20000n },
        } satisfies RelationshipChange;
        const preview = yield* relationships.preview({ change });
        expect(
          preview.impacts.find((impact) => impact.start === "2026-09-01")?.after.netPersonalCosts
            .minor,
        ).toBe(10000n);
        expect(
          preview.impacts.find((impact) => impact.start === "2026-10-01")?.after.income.minor,
        ).toBe(0n);
        return { commandId: yield* commandId, change, expectedVersions: preview.expectedVersions };
      }),
    );
    const results = yield* Effect.forEach(
      inputs,
      (input) => relationships.apply(input).pipe(Effect.result),
      { concurrency: 2 },
    );
    expect(results.filter((result) => result._tag === "Success")).toHaveLength(1);
    expect(
      results.filter((result) => result._tag === "Failure").map((result) => result.failure.kind),
    ).toEqual(["conflict"]);
    const detail = yield* relationships.get({ eventId: dinner.id });
    expect(detail.remaining[0]?.amount.minor).toBe(10000n);
    const events = yield* Events;
    const current = yield* events.get({ eventId: dinner.id });
    const invalid = yield* corrections
      .apply({
        commandId: yield* commandId,
        expectedVersions: [{ eventId: current.id, version: current.version }],
        change: {
          eventId: current.id,
          kind: "transfer",
          purchaseOn: null,
          allocations: [{ ...current.allocations[0], role: "transfer" }],
        },
      })
      .pipe(Effect.result);
    expect(invalid._tag === "Failure" && invalid.failure.kind).toBe("conflict");
    const link = detail.credits[0];
    if (!link) return yield* Effect.die("Expected applied credit");
    const removed = yield* apply({ kind: "unlinkCredit", creditLinkId: link.id });
    expect(
      removed.impacts.find((impact) => impact.start === "2026-09-01")?.after.netPersonalCosts.minor,
    ).toBe(30000n);
  }).pipe(Effect.provide(services)),
);

test(
  "external transfers and fee associations preserve costs, and account periods use exclusive end dates",
  Effect.gen(function* () {
    yield* reset;
    const owner = yield* createAccount("deposit", "Cash");
    const loan = yield* createAccount("loan", "Mortgage");
    const rows = yield* createEvents(owner, [
      { description: "Transfer to savings", minor: -200000n },
      { description: "Purchase Card xx1234", minor: -10000n },
      { description: "International Fee", minor: -300n },
    ]);
    const transfer = find(rows, "Transfer to savings");
    const preview = yield* apply({
      kind: "linkMovement",
      eventId: transfer.id,
      movementKind: "transfer",
      counterpart: { kind: "external", label: "External savings" },
    });
    expect(preview.impacts[0]?.after.grossCosts.minor).toBe(10300n);
    expect(preview.impacts[0]?.after.income.minor).toBe(0n);
    const fee = find(rows, "International Fee");
    const purchase = find(rows, "Purchase Card xx1234");
    const feePreview = yield* apply({
      kind: "associateFee",
      feeEventId: fee.id,
      purchaseEventId: purchase.id,
      status: "confirmed",
    });
    expect(feePreview.impacts[0]?.before).toEqual(feePreview.impacts[0]?.after);
    const history = yield* AccountHistory;
    const period = {
      kind: "label",
      id: AccountPeriodId.make(yield* uuid),
      accountId: owner.id,
      startOn: CalendarDate.make("2026-09-01"),
      endOn: CalendarDate.make("2026-10-01"),
      label: "Offset cash",
      version: 1,
    } as const;
    yield* history.save({ commandId: yield* commandId, record: period, expectedVersion: null });
    yield* history.save({
      commandId: yield* commandId,
      record: {
        kind: "offset",
        id: AccountPeriodId.make(yield* uuid),
        accountId: owner.id,
        loanAccountId: loan.id,
        startOn: period.startOn,
        endOn: period.endOn,
        version: 1,
      },
      expectedVersion: null,
    });
    const overlap = yield* history
      .save({
        commandId: yield* commandId,
        record: { ...period, id: AccountPeriodId.make(yield* uuid) },
        expectedVersion: null,
      })
      .pipe(Effect.result);
    expect(overlap._tag === "Failure" && overlap.failure.kind).toBe("conflict");
    const postings = yield* Postings;
    expect(
      (yield* postings.get({ postingId: transfer.primaryPostingId })).posting.accountLabel,
    ).toBe("Offset cash");
    const [later] = yield* createEvents(owner, [
      { description: "October purchase Card xx1234", minor: -100n, on: "2026-10-01" },
    ]);
    expect(later?.postings[0]?.accountLabel).toBe("Cash");
  }).pipe(Effect.provide(services)),
);

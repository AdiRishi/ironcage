import { describe, expect, it } from "@effect/vitest";
import { AllocationId, CalendarDate, CounterpartyId, EventId } from "@repo/contracts/finance";

import { creditProposals, type CostSide, type CreditSide } from "../src/index.ts";

const id = (prefix: string, n: number) => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const myer = CounterpartyId.make(id("50000000", 1));
const aud = (minor: bigint) => ({ currency: "AUD", minor });
const credit = (n: number, fields: Partial<CreditSide>): CreditSide => ({
  eventId: EventId.make(id("30000000", n)),
  allocationId: AllocationId.make(id("40000000", n)),
  kind: "refund",
  counterpartyId: null,
  aliasKey: null,
  reference: null,
  postedOn: CalendarDate.make("2026-08-02"),
  remaining: aud(4000n),
  ...fields,
});
const cost = (n: number, fields: Partial<CostSide>): CostSide => ({
  eventId: EventId.make(id("30000000", n)),
  allocationId: AllocationId.make(id("40000000", n)),
  counterpartyId: null,
  aliasKey: null,
  description: "Synthetic purchase",
  spendingOn: CalendarDate.make("2026-07-15"),
  remaining: aud(12000n),
  ...fields,
});
const pairs = (credits: CreditSide[], costs: CostSide[]) =>
  creditProposals({ credits, costs }).map((row) => [
    row.creditEventId,
    row.costEventId,
    row.amount.minor,
  ]);

describe("creditProposals", () => {
  it("proposes a refund against the one purchase from the same counterparty", () => {
    const refund = credit(1, { counterpartyId: myer });
    const purchase = cost(2, { counterpartyId: myer });
    expect(pairs([refund], [purchase, cost(3, {})])).toEqual([
      [refund.eventId, purchase.eventId, 4000n],
    ]);
  });

  it("prefers the purchase with exactly the refunded amount, and proposes nothing when two could be it", () => {
    const refund = credit(1, { aliasKey: "MYER SYDNEY" });
    const exact = cost(2, { aliasKey: "MYER SYDNEY", remaining: aud(4000n) });
    const larger = cost(3, { aliasKey: "MYER SYDNEY" });
    expect(pairs([refund], [larger, exact])).toEqual([[refund.eventId, exact.eventId, 4000n]]);
    expect(pairs([refund], [larger, cost(4, { aliasKey: "MYER SYDNEY" })])).toEqual([]);
  });

  it("ignores purchases outside the refund window or smaller than the refund", () => {
    const refund = credit(1, { counterpartyId: myer });
    expect(
      pairs(
        [refund],
        [
          cost(2, { counterpartyId: myer, spendingOn: CalendarDate.make("2026-03-01") }),
          cost(3, { counterpartyId: myer, remaining: aud(3000n) }),
        ],
      ),
    ).toEqual([]);
  });

  it("proposes a repayment against the recent larger purchase its reference names", () => {
    const repaid = credit(1, {
      kind: "reimbursement",
      reference: "dinner split",
      postedOn: CalendarDate.make("2026-07-06"),
      remaining: aud(20000n),
    });
    const dinner = cost(2, {
      description: "Dinner Place SYDNEY AU Card xx1234",
      spendingOn: CalendarDate.make("2026-07-04"),
      remaining: aud(30000n),
    });
    const groceries = cost(3, {
      description: "WOOLWORTHS 1234 SYDNEY AU",
      spendingOn: CalendarDate.make("2026-07-05"),
      remaining: aud(50000n),
    });
    expect(pairs([repaid], [dinner, groceries])).toEqual([
      [repaid.eventId, dinner.eventId, 20000n],
    ]);
    expect(pairs([{ ...repaid, reference: null }], [dinner, groceries])).toEqual([]);
  });
});

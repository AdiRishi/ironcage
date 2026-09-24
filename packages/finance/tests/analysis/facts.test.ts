import { describe, expect, it } from "@effect/vitest";
import {
  AccountId,
  AllocationId,
  CalendarDate,
  CategoryId,
  CounterpartyId,
  EventId,
  PostingId,
  type FinancialEvent,
} from "@repo/contracts/finance";

import { eventLedgerFacts } from "../../src/index.ts";

const id = (prefix: string, n: number) => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const deposit = AccountId.make(id("00000000", 1));
const loan = AccountId.make(id("00000000", 2));
const clothing = CategoryId.make(id("10000000", 1));
const shopping = CategoryId.make(id("10000000", 2));
const accountKinds = new Map([
  [deposit, "deposit" as const],
  [loan, "loan" as const],
]);
const topCategory = (category: string) => (category === clothing ? shopping : null);

function event(
  n: number,
  fields: Partial<FinancialEvent> & {
    minor: bigint;
    categoryId?: typeof CategoryId.Type | null;
    accounts?: (typeof AccountId.Type)[];
  },
): FinancialEvent {
  const { minor, categoryId = null, accounts = [deposit], ...rest } = fields;
  const kind = rest.kind ?? "purchase";
  const role = kind === "loanPayment" || kind === "cardSettlement" ? "transfer" : kind;
  const postings = accounts.map((accountId, index) => ({
    id: PostingId.make(id("20000000", n * 10 + index)),
    accountId,
    accountLabel: "Account",
    postedOn: CalendarDate.make("2026-04-02"),
    valueOn: null,
    description: "Synthetic",
    amount: { currency: "AUD", minor: index === 0 ? minor : -minor },
    originalMoney: null,
  }));
  return {
    id: EventId.make(id("30000000", n)),
    kind,
    roleSource: "bank",
    counterpartyId: null,
    counterpartySource: null,
    magnitude: { currency: "AUD", minor: minor < 0n ? -minor : minor },
    primaryPostingId: postings[0]!.id,
    reportingAccountId: accounts[0]!,
    purchaseOn: null,
    active: true,
    version: 1,
    allocations: [
      {
        id: AllocationId.make(id("40000000", n)),
        role,
        amount: { currency: "AUD", minor: minor < 0n ? -minor : minor },
        categoryId,
        categorySource: categoryId ? "counterparty" : null,
        nonPersonal: false,
        tagIds: [],
        personalEventIds: [],
      },
    ],
    postings,
    ...rest,
  };
}
const facts = (
  value: FinancialEvent,
  extra: Partial<Parameters<typeof eventLedgerFacts>[0]> = {},
) =>
  eventLedgerFacts({
    event: value,
    accountKinds,
    counterparty: null,
    credits: [],
    topCategory,
    ...extra,
  });

describe("eventLedgerFacts", () => {
  it("puts a purchase in its category and top-level category", () => {
    expect(facts(event(1, { minor: -12000n, categoryId: clothing }))).toMatchObject([
      {
        measure: "spending",
        amountMinor: 12000n,
        categoryId: clothing,
        topCategoryId: shopping,
        purchase: true,
      },
    ]);
  });

  it("lets an unlinked refund reduce its category on its own date", () => {
    expect(facts(event(2, { kind: "refund", minor: 4000n, categoryId: clothing }))).toMatchObject([
      { measure: "spending", amountMinor: -4000n, postedOn: "2026-04-02", categoryId: clothing },
    ]);
  });

  it("moves a linked credit to the purchase's period and keeps the rest on its own date", () => {
    const refund = event(3, { kind: "refund", minor: 5000n, categoryId: null });
    const result = facts(refund, {
      credits: [
        {
          creditAllocationId: refund.allocations[0].id,
          amountMinor: 4000n,
          categoryId: clothing,
          accountId: deposit,
          postedOn: CalendarDate.make("2026-03-10"),
          spendingOn: CalendarDate.make("2026-03-09"),
          counterpartyId: null,
        },
      ],
    });
    expect(result).toMatchObject([
      { measure: "spending", amountMinor: -4000n, spendingOn: "2026-03-09", categoryId: clothing },
      { measure: "unresolvedIn", amountMinor: 1000n },
    ]);
  });

  it("counts a loan repayment once, from the account the cash left", () => {
    expect(facts(event(4, { kind: "loanPayment", minor: -390000n }))[0]?.measure).toBe(
      "loanRepayment",
    );
    expect(
      facts(event(5, { kind: "loanPayment", minor: 390000n, accounts: [loan] }))[0]?.measure,
    ).toBe("internal");
    expect(
      facts(event(6, { kind: "loanPayment", minor: -390000n, accounts: [deposit, loan] }))[0]
        ?.measure,
    ).toBe("loanRepayment");
  });

  it("separates moving money to your own account elsewhere from moving it between ledger accounts", () => {
    const moved = event(7, { kind: "transfer", minor: -500000n });
    expect(facts(moved)[0]?.measure).toBe("internal");
    expect(
      facts(
        { ...moved, counterpartyId: CounterpartyId.make(id("50000000", 1)) },
        { counterparty: { kind: "ownAccount", source: "user" } },
      )[0]?.measure,
    ).toBe("externalOut");
  });

  it("marks a value inherited from a model-made counterparty", () => {
    const purchase = {
      ...event(8, { minor: -900n, categoryId: clothing }),
      roleSource: "bank" as const,
    };
    expect(
      facts(purchase, { counterparty: { kind: "business", source: "model" } })[0]?.modelAssigned,
    ).toBe(true);
    expect(
      facts(purchase, { counterparty: { kind: "business", source: "user" } })[0]?.modelAssigned,
    ).toBe(false);
  });
});

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
const savings = AccountId.make(id("00000000", 3));
const clothing = CategoryId.make(id("10000000", 1));
const accountKinds = new Map([
  [deposit, "deposit" as const],
  [loan, "loan" as const],
  [savings, "deposit" as const],
]);
const postingId = (n: number, index: number) => PostingId.make(id("20000000", n * 10 + index));

function event(
  n: number,
  fields: Partial<FinancialEvent> & {
    minor: bigint;
    categoryId?: typeof CategoryId.Type | null;
    accounts?: (typeof AccountId.Type)[];
    dates?: string[];
  },
): FinancialEvent {
  const { minor, categoryId = null, accounts = [deposit], dates = [], ...rest } = fields;
  const kind = rest.kind ?? "purchase";
  const role = kind === "loanPayment" || kind === "cardSettlement" ? "transfer" : kind;
  const postings = accounts.map((accountId, index) => ({
    id: postingId(n, index),
    accountId,
    accountLabel: "Account",
    postedOn: CalendarDate.make(dates[index] ?? "2026-04-02"),
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
    links: [],
    ...extra,
  });

describe("eventLedgerFacts", () => {
  it("counts a purchase as spending in its category", () => {
    expect(facts(event(1, { minor: -12000n, categoryId: clothing }))).toMatchObject([
      { measure: "spending", amountMinor: 12000n, categoryId: clothing, purchase: true },
    ]);
  });

  it("lets an unlinked refund reduce its category on its own date", () => {
    expect(facts(event(2, { kind: "refund", minor: 4000n, categoryId: clothing }))).toMatchObject([
      { measure: "spending", amountMinor: -4000n, postedOn: "2026-04-02", categoryId: clothing },
    ]);
  });

  it("reduces the linked purchase in its own category and period, and keeps the rest of the credit on its own date", () => {
    const purchase = event(3, {
      minor: -12000n,
      categoryId: clothing,
      purchaseOn: CalendarDate.make("2026-03-09"),
    });
    const refund = event(7, { kind: "refund", minor: 5000n, categoryId: null });
    const links = [
      {
        creditAllocationId: refund.allocations[0].id,
        costAllocationId: purchase.allocations[0].id,
        amount: { currency: "AUD", minor: 4000n },
        creditEventId: refund.id,
      },
    ];
    expect(facts(purchase, { links })).toMatchObject([
      { measure: "spending", amountMinor: 12000n, spendingOn: "2026-03-09", categoryId: clothing },
      { measure: "spending", amountMinor: -4000n, spendingOn: "2026-03-09", categoryId: clothing },
    ]);
    expect(facts(refund, { links })).toMatchObject([
      { measure: "unresolvedIn", amountMinor: 1000n },
    ]);
  });

  it("drops a credit linked to a non-personal cost from every measure", () => {
    const purchase = event(8, { minor: -12000n, categoryId: clothing });
    const [allocation] = purchase.allocations;
    const workDinner: FinancialEvent = {
      ...purchase,
      allocations: [{ ...allocation, nonPersonal: true }],
    };
    const refund = event(9, { kind: "reimbursement", minor: 12000n, categoryId: clothing });
    const links = [
      {
        creditAllocationId: refund.allocations[0].id,
        costAllocationId: allocation.id,
        amount: { currency: "AUD", minor: 12000n },
        creditEventId: refund.id,
      },
    ];
    expect(facts(workDinner, { links })).toEqual([]);
    expect(facts(refund, { links })).toEqual([]);
  });

  it("names the credit a linked reduction comes from, on the purchase's own posting", () => {
    const purchase = event(10, { minor: -30000n, categoryId: clothing });
    const repaid = event(11, { kind: "reimbursement", minor: 20000n, categoryId: clothing });
    const links = [
      {
        creditAllocationId: repaid.allocations[0].id,
        costAllocationId: purchase.allocations[0].id,
        amount: { currency: "AUD", minor: 20000n },
        creditEventId: repaid.id,
      },
    ];
    expect(facts(purchase, { links })).toMatchObject([
      { amountMinor: 30000n, postingId: postingId(10, 0), creditEventId: null },
      { amountMinor: -20000n, postingId: postingId(10, 0), creditEventId: repaid.id },
    ]);
  });

  it("counts a loan repayment once, on the deposit posting on the day the cash left", () => {
    const pair = event(6, {
      kind: "loanPayment",
      minor: 390000n,
      accounts: [loan, deposit],
      dates: ["2026-02-01", "2026-01-31"],
    });
    expect(facts(pair)).toMatchObject([
      {
        measure: "loanRepayment",
        amountMinor: 390000n,
        postingId: postingId(6, 1),
        accountId: deposit,
        postedOn: "2026-01-31",
        spendingOn: "2026-01-31",
      },
    ]);
    expect(facts(event(4, { kind: "loanPayment", minor: -390000n }))).toMatchObject([
      { measure: "loanRepayment", postingId: postingId(4, 0) },
    ]);
    expect(
      facts(event(5, { kind: "loanPayment", minor: 390000n, accounts: [loan] })),
    ).toMatchObject([{ measure: "internal" }]);
  });

  it("counts borrowing when the cash arrives in an account outside your loans", () => {
    const pair = event(12, {
      kind: "borrowing",
      minor: -500000n,
      accounts: [loan, deposit],
      dates: ["2026-03-02", "2026-03-03"],
    });
    expect(facts(pair)).toMatchObject([
      {
        measure: "borrowing",
        amountMinor: 500000n,
        postingId: postingId(12, 1),
        accountId: deposit,
        postedOn: "2026-03-03",
      },
    ]);
    expect(facts(event(13, { kind: "borrowing", minor: 500000n }))).toMatchObject([
      { measure: "borrowing", postingId: postingId(13, 0) },
    ]);
    expect(
      facts(event(14, { kind: "borrowing", minor: -500000n, accounts: [loan] })),
    ).toMatchObject([{ measure: "internal" }]);
  });

  it("keeps a transfer internal only when its other side is one of your ledger accounts", () => {
    const toSavings = event(15, { kind: "transfer", minor: -500000n });
    expect(facts(toSavings)).toMatchObject([{ measure: "internal" }]);
    expect(
      facts({
        ...event(16, { kind: "transfer", minor: -500000n, accounts: [deposit, savings] }),
        roleSource: "link",
      }),
    ).toMatchObject([{ measure: "internal" }]);
    expect(facts({ ...toSavings, roleSource: "link" })).toMatchObject([
      { measure: "externalOut", amountMinor: 500000n },
    ]);
    expect(
      facts(
        {
          ...toSavings,
          roleSource: "counterparty",
          counterpartyId: CounterpartyId.make(id("50000000", 1)),
        },
        { counterparty: { source: "user" } },
      ),
    ).toMatchObject([{ measure: "externalOut", amountMinor: 500000n }]);
    expect(
      facts({ ...event(17, { kind: "transfer", minor: 200000n }), roleSource: "user" }),
    ).toMatchObject([{ measure: "externalIn", amountMinor: 200000n }]);
  });

  it("marks a value inherited from a model-made counterparty", () => {
    const purchase = {
      ...event(8, { minor: -900n, categoryId: clothing }),
      roleSource: "bank" as const,
    };
    expect(facts(purchase, { counterparty: { source: "model" } })[0]?.modelAssigned).toBe(true);
    expect(facts(purchase, { counterparty: { source: "user" } })[0]?.modelAssigned).toBe(false);
  });
});

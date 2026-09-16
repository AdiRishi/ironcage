import { CalendarDate, CreditLinkId, type OverviewInput } from "@repo/contracts/finance";
import { expect, it } from "vitest";

import { calculateOverview } from "../../src/analysis/measures.ts";
import { deposit, card, loan, purchase, snapshot } from "./fixtures.ts";
const period = {
  start: CalendarDate.make("2026-08-01"),
  endExclusive: CalendarDate.make("2026-09-01"),
};
const input: OverviewInput = {
  period: { kind: "fixed", ...period },
  basis: "spending",
  currency: "AUD",
  accounts: [],
};
it("keeps later refunds in the purchase period and excludes settlements and borrowing from income and costs", () => {
  const cost = purchase(1, 30000n, "2026-08-02", card);
  const credit = purchase(2, 20000n, "2026-09-02", deposit);
  const income = purchase(3, 100000n);
  const financing = purchase(4, 280000n, "2026-08-31", loan);
  const repayment = purchase(5, 390000n, "2026-08-28", loan);
  const settlement = purchase(6, 30000n);
  const borrowing = purchase(7, 500000n, "2026-08-20", loan);
  const data = snapshot([
    cost,
    { ...credit, kind: "refund", allocations: [{ ...credit.allocations[0], role: "refund" }] },
    { ...income, kind: "income", allocations: [{ ...income.allocations[0], role: "income" }] },
    {
      ...financing,
      kind: "financingCost",
      allocations: [{ ...financing.allocations[0], role: "financingCost" }],
    },
    {
      ...repayment,
      kind: "loanPayment",
      allocations: [{ ...repayment.allocations[0], role: "transfer" }],
    },
    {
      ...settlement,
      kind: "cardSettlement",
      allocations: [{ ...settlement.allocations[0], role: "transfer" }],
    },
    {
      ...borrowing,
      kind: "borrowing",
      allocations: [{ ...borrowing.allocations[0], role: "borrowing" }],
    },
  ]);
  data.credits = [
    {
      id: CreditLinkId.make("00000000-0000-4000-8000-000000000050"),
      creditAllocationId: credit.allocations[0].id,
      costAllocationId: cost.allocations[0].id,
      creditEventId: credit.id,
      costEventId: cost.id,
      amount: { currency: "AUD", minor: 20000n },
    },
  ];
  const result = calculateOverview(data, input, period, "2026-09-16T00:00:00.000Z");
  expect(result.grossCosts.minor).toBe(310000n);
  expect(result.netPersonalCosts.minor).toBe(290000n);
  expect(result.income.minor).toBe(100000n);
  expect(result.surplus.minor).toBe(-190000n);
  expect(result.surplusRate).toBe("-190.000000");
  expect(result.purchaseCount).toBe(1);
  expect(result.loans[0]?.netPrincipalReduction?.minor).toBe(110000n);
});

it("coverage includes the magnitude of postings still awaiting interpretation", () => {
  const data = snapshot([]);
  data.postings = [
    ...purchase(1, 1250n).postings,
    ...purchase(2, 400n).postings.map((posting) => ({
      ...posting,
      amount: { currency: "AUD", minor: 400n },
    })),
  ];
  const result = calculateOverview(data, input, period, "2026-09-16T00:00:00.000Z");
  expect(result.coverage.unresolvedCount).toBe(2);
  expect(result.coverage.unresolvedAmount.minor).toBe(1650n);
});

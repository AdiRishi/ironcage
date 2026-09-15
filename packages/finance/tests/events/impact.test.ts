import { AccountId, AllocationId, CalendarDate, EventId } from "@repo/contracts/finance";
import { expect, test } from "vitest";

import { type MeasureFact, periodMeasures } from "../../src/impact.ts";
const loan = AccountId.make("00000000-0000-4000-8000-000000000001");
const repayment: MeasureFact = {
  eventId: EventId.make("00000000-0000-4000-8000-000000000002"),
  allocationId: AllocationId.make("00000000-0000-4000-8000-000000000003"),
  accountId: loan,
  postedOn: CalendarDate.make("2026-09-06"),
  kind: "loanPayment",
  role: "transfer",
  amount: { currency: "AUD", minor: 390000n },
  nonPersonal: false,
};
const interest: MeasureFact = {
  ...repayment,
  eventId: EventId.make("00000000-0000-4000-8000-000000000004"),
  allocationId: AllocationId.make("00000000-0000-4000-8000-000000000005"),
  kind: "financingCost",
  role: "financingCost",
  amount: { currency: "AUD", minor: 280000n },
  postedOn: CalendarDate.make("2026-08-31"),
};
const context = {
  currency: "AUD",
  loanAccountIds: [loan],
  observedCashMovement: -390000n,
  cashComplete: true,
  loanComplete: true,
};
test("interest stays in its posted period and loan principal is available only with complete coverage", () => {
  const september = periodMeasures({ ...context, facts: [repayment] });
  expect(september.grossCosts.minor).toBe(0n);
  expect(september.netPrincipalReduction?.minor).toBe(390000n);
  const august = periodMeasures({ ...context, facts: [interest], observedCashMovement: 0n });
  expect(august.grossCosts.minor).toBe(280000n);
  const sameMonth = periodMeasures({
    ...context,
    facts: [repayment, { ...interest, postedOn: CalendarDate.make("2026-09-07") }],
  });
  expect(sameMonth.grossCosts.minor).toBe(280000n);
  expect(sameMonth.netPrincipalReduction?.minor).toBe(110000n);
  expect(
    periodMeasures({ ...context, facts: [repayment, interest], loanComplete: false })
      .netPrincipalReduction,
  ).toBeNull();
});

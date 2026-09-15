import { it, expect } from "@effect/vitest";

import { sourceRole } from "../../src/events.ts";

it("source markers distinguish costs, movements, and credits without inferring income", () => {
  expect(
    sourceRole({ description: "Shop Card xx1234", minor: -10000n, accountKind: "deposit" }),
  ).toBe("purchase");
  expect(
    sourceRole({ description: "Shop Card xx1234", minor: 10000n, accountKind: "deposit" }),
  ).toBe("unresolved");
  expect(
    sourceRole({ description: "Interest charged", minor: -280000n, accountKind: "loan" }),
  ).toBe("financingCost");
  expect(sourceRole({ description: "Interest credit", minor: 500n, accountKind: "deposit" })).toBe(
    "unresolved",
  );
  expect(
    sourceRole({ description: "Repayment/Payment", minor: 390000n, accountKind: "loan" }),
  ).toBe("loanPayment");
  expect(sourceRole({ description: "Payment received", minor: 10000n, accountKind: "card" })).toBe(
    "cardSettlement",
  );
  expect(
    sourceRole({ description: "Transfer to savings", minor: -200000n, accountKind: "deposit" }),
  ).toBe("transfer");
  expect(
    sourceRole({ description: "Money we lent you", minor: -50000000n, accountKind: "loan" }),
  ).toBe("borrowing");
  expect(
    sourceRole({ description: "Employer payroll", minor: 800000n, accountKind: "deposit" }),
  ).toBe("unresolved");
});

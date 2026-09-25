import { describe, expect, it } from "@effect/vitest";

import {
  averagePurchase,
  changeFigures,
  percentChange,
  shares,
  type ChangeSums,
} from "../../src/index.ts";

const sums = (fields: Partial<ChangeSums>): ChangeSums => ({
  current: 0n,
  previous: 0n,
  purchaseCurrent: 0n,
  purchasePrevious: 0n,
  purchases: 0,
  previousPurchases: 0,
  ...fields,
});

describe("changeFigures", () => {
  it("leaves interest and credits linked to no purchase out of the average purchase", () => {
    // $1,840 of rent, $2,800 of mortgage interest, and a $50 refund linked to no purchase.
    const figures = changeFigures(
      sums({ current: 184000n + 280000n - 5000n, purchaseCurrent: 184000n, purchases: 1 }),
      "AUD",
    );
    expect(figures.averagePurchase).toEqual({ currency: "AUD", minor: 184000n });
  });

  it("splits a change into more purchases, dearer purchases, and other spending that sum to it", () => {
    // 10 orders at $20 become 12 orders at $25, and a $10 refund linked to no order arrives.
    const figures = changeFigures(
      sums({
        previous: 20000n,
        purchasePrevious: 20000n,
        previousPurchases: 10,
        current: 30000n - 1000n,
        purchaseCurrent: 30000n,
        purchases: 12,
      }),
      "AUD",
    );
    expect(figures).toMatchObject({
      change: { minor: 9000n },
      percentChange: 45,
      averagePurchase: { minor: 2500n },
      previousAveragePurchase: { minor: 2000n },
      purchasesPart: { minor: 4500n },
      averagePart: { minor: 5500n },
      otherPart: { minor: -1000n },
    });
  });

  it("gives no purchases or average part when the comparison period had no purchases", () => {
    // Only $50 of interest before; two purchases totalling $80 and the same interest now.
    const figures = changeFigures(
      sums({ previous: 5000n, current: 13000n, purchaseCurrent: 8000n, purchases: 2 }),
      "AUD",
    );
    expect(figures).toMatchObject({
      change: { minor: 8000n },
      averagePurchase: { minor: 4000n },
      previousAveragePurchase: null,
      purchasesPart: null,
      averagePart: null,
      otherPart: { minor: 0n },
    });
  });
});

it("rounds an average purchase to the nearest cent, halves away from zero", () => {
  expect(averagePurchase(10001n, 2)).toBe(5001n);
  expect(averagePurchase(20000n, 3)).toBe(6667n);
  expect(averagePurchase(0n, 0)).toBeNull();
});

it("gives a change as a whole percent, and none when the earlier period was zero or negative", () => {
  expect(percentChange(22500n, 20000n)).toBe(13);
  expect(percentChange(17500n, 20000n)).toBe(-13);
  expect(percentChange(0n, 1000n)).toBe(-100);
  expect(percentChange(500n, 0n)).toBeNull();
  expect(percentChange(1000n, -500n)).toBeNull();
});

it("gives each part a whole percent of the spending parts, and none to a part without spending", () => {
  expect(shares([20000n, 10000n])).toEqual([67, 33]);
  // Nothing this period, only in the comparison period.
  expect(shares([30000n, 0n])).toEqual([100, null]);
});

it("keeps a share within 100% beside a repayment linked to no purchase", () => {
  // A $300 dinner at Dinner Place, and John's $200 repayment of it before it is linked:
  // the scope is $100, but the dinner is still all of what was spent.
  expect(shares([30000n, -20000n])).toEqual([100, null]);
  expect(shares([9000n, 6000n, -5000n])).toEqual([60, 40, null]);
});

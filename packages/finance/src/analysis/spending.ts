import type { ChangeFigures, Money } from "@repo/contracts/finance";

import { divideRounded } from "../money.ts";
import { purchaseDecomposition } from "./decomposition.ts";

// Spending summed for the current and comparison periods. The purchase sums hold only
// the facts of purchase events, which include the credits linked to them, and the counts
// are the purchases with positive spending.
export type ChangeSums = {
  current: bigint;
  previous: bigint;
  purchaseCurrent: bigint;
  purchasePrevious: bigint;
  purchases: number;
  previousPurchases: number;
};

// Interest, fees, and credits linked to no purchase are spending but not purchases, so
// they stay out of the average.
export function averagePurchase(purchaseSpending: bigint, purchases: number) {
  return purchases === 0 ? null : divideRounded(purchaseSpending, BigInt(purchases));
}

// A change from nothing has no ratio, and one from net refunds has no meaningful sign.
export function percentChange(current: bigint, previous: bigint) {
  return previous > 0n ? Number(divideRounded((current - previous) * 100n, previous)) : null;
}

// How far `current` moved from `previous`, as money and as a whole percent.
export function compareMoney(current: Money, previous: Money) {
  return {
    change: { currency: current.currency, minor: current.minor - previous.minor },
    percentChange: percentChange(current.minor, previous.minor),
  };
}

// Each part's whole percent of what the positive parts add up to. A part that spent
// nothing or took money back has no share, so a net refund beside the other parts neither
// takes a share nor pushes theirs past 100%.
export function shares(parts: readonly bigint[]) {
  const whole = parts.reduce((total, part) => (part > 0n ? total + part : total), 0n);
  return parts.map((part) => (part > 0n ? Number(divideRounded(part * 100n, whole)) : null));
}

// Splits the change in purchase spending into a purchases part and an average part, and
// reports the change in the rest of spending as the other part. When both periods have
// purchases, the three sum to the change.
export function changeFigures(sums: ChangeSums, currency: string): ChangeFigures {
  const money = (minor: bigint) => ({ currency, minor });
  const average = (purchaseSpending: bigint, purchases: number) => {
    const minor = averagePurchase(purchaseSpending, purchases);
    return minor === null ? null : money(minor);
  };
  const parts = purchaseDecomposition({
    n0: BigInt(sums.previousPurchases),
    n1: BigInt(sums.purchases),
    t0: sums.purchasePrevious,
    t1: sums.purchaseCurrent,
  });
  return {
    current: money(sums.current),
    previous: money(sums.previous),
    ...compareMoney(money(sums.current), money(sums.previous)),
    purchases: sums.purchases,
    previousPurchases: sums.previousPurchases,
    averagePurchase: average(sums.purchaseCurrent, sums.purchases),
    previousAveragePurchase: average(sums.purchasePrevious, sums.previousPurchases),
    purchasesPart: parts ? money(parts.purchases) : null,
    averagePart: parts ? money(parts.average) : null,
    otherPart: money(sums.current - sums.purchaseCurrent - (sums.previous - sums.purchasePrevious)),
  };
}

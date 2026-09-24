// Splits a change in total spending t0 → t1 across n0 → n1 purchases into a part from
// the number of purchases and a part from the average purchase, using the midpoint
// rule so the two sum exactly to the change. Parts are floored to minor units and the
// leftover goes to the part with the larger remainder.
export function purchaseDecomposition({
  n0,
  n1,
  t0,
  t1,
}: {
  n0: bigint;
  n1: bigint;
  t0: bigint;
  t1: bigint;
}): { purchases: bigint; average: bigint } | null {
  if (n0 === 0n || n1 === 0n) return null;
  const denominator = 2n * n0 * n1;
  const purchases = (n1 - n0) * (t0 * n1 + t1 * n0);
  const average = (t1 - t0) * denominator - purchases;
  const floor = (numerator: bigint) =>
    numerator / denominator - (numerator < 0n && numerator % denominator !== 0n ? 1n : 0n);
  let purchasesMinor = floor(purchases);
  let averageMinor = floor(average);
  const remaining = t1 - t0 - purchasesMinor - averageMinor;
  if (remaining > 0n) {
    if (purchases - purchasesMinor * denominator > average - averageMinor * denominator)
      purchasesMinor += remaining;
    else averageMinor += remaining;
  }
  return { purchases: purchasesMinor, average: averageMinor };
}

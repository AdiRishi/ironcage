export function roundHalfEven(numerator: bigint, denominator: bigint): bigint {
  if (denominator < 0n) return roundHalfEven(-numerator, -denominator);
  const sign = numerator < 0n ? -1n : 1n;
  const value = numerator * sign;
  const quotient = value / denominator;
  const remainder = value % denominator;
  return (
    sign *
    (quotient +
      (2n * remainder > denominator || (2n * remainder === denominator && quotient % 2n !== 0n)
        ? 1n
        : 0n))
  );
}
export function decimalRatio(numerator: bigint, denominator: bigint, places = 6) {
  const scale = 10n ** BigInt(places);
  const rounded = roundHalfEven(numerator * scale, denominator);
  const absolute = rounded < 0n ? -rounded : rounded;
  return `${rounded < 0n ? "-" : ""}${absolute / scale}.${(absolute % scale).toString().padStart(places, "0")}`;
}

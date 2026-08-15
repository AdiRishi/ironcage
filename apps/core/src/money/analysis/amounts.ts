import { Aud } from "@ironcage/domain";
import { BigDecimal, Schema } from "effect";

const decodeAud = Schema.decodeUnknownSync(Aud);

export const zero = BigDecimal.fromBigInt(0n);
export const decimal = BigDecimal.fromStringUnsafe;

export const toAud = (value: BigDecimal.BigDecimal) =>
  decodeAud(BigDecimal.format(BigDecimal.round(value, { scale: 2, mode: "half-even" })));

export const medianAmount = (values: readonly BigDecimal.BigDecimal[]): BigDecimal.BigDecimal => {
  const sorted = [...values].sort(BigDecimal.Order);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : BigDecimal.divideUnsafe(BigDecimal.sum(sorted[middle - 1]!, sorted[middle]!), decimal("2"));
};

export const medianNumber = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

import { BigDecimal, Schema } from "effect";

/**
 * Every quantity of money, price, or asset is a `BigDecimal` carried as a
 * string.
 *
 * Postgres returns `numeric` as a string precisely because it does not fit a
 * double, and node-postgres preserves that. Decoding to `Schema.Number` would
 * silently truncate — `999999999999.12345678` becomes `999999999999.1234` —
 * and nothing would fail. The same string form crosses the wire, so a JSON
 * number never gets the chance to do it either.
 */
const fitsNumeric = (precision: number, scale: number) =>
  Schema.makeFilter<BigDecimal.BigDecimal>(
    (value) => {
      const normalized = BigDecimal.normalize(value);
      const magnitude = normalized.value < 0n ? -normalized.value : normalized.value;
      const significantDigits = magnitude === 0n ? 0 : magnitude.toString().length;
      const integerDigits = Math.max(significantDigits - normalized.scale, 0);
      const fractionalDigits = Math.max(normalized.scale, 0);

      return integerDigits <= precision - scale && fractionalDigits <= scale;
    },
    { expected: `a decimal fitting PostgreSQL numeric(${precision},${scale})` },
  );

const financialDecimal = <const Name extends string>(
  name: Name,
  precision: number,
  scale: number,
) => Schema.BigDecimalFromString.check(fitsNumeric(precision, scale)).pipe(Schema.brand(name));

/** `numeric(20,8)`, which Postgres caps just under 10^12 units. */
export const Money = financialDecimal("Money", 20, 8);
export type Money = typeof Money.Type;

/**
 * Arithmetic produces a plain `BigDecimal`; storage and contracts demand a
 * `Money`. Rounding to the stored scale is what makes a division result
 * expressible as `numeric(20,8)` at all.
 *
 * The result carries the same representation `Money` decodes a string into, so
 * a computed amount and the same amount read back from Postgres are one value
 * rather than two that merely compare equal. `normalize` alone would not: it
 * writes ten as 1×10¹, and decoding "10" writes it as 10×10⁰.
 */
export const money = (value: BigDecimal.BigDecimal): Money => {
  const normalized = BigDecimal.normalize(BigDecimal.round(value, { scale: 8, mode: "half-even" }));
  const stored =
    normalized.scale < 0
      ? BigDecimal.make(normalized.value * 10n ** BigInt(-normalized.scale), 0)
      : normalized;

  Schema.asserts(Money, stored);
  return stored;
};

/** `numeric(24,8)`, wider in the integer part than `Money` for venue prices. */
export const Price = financialDecimal("Price", 24, 8);
export type Price = typeof Price.Type;

/** `numeric(38,18)`, sized for crypto asset quantities. */
export const Quantity = financialDecimal("Quantity", 38, 18);
export type Quantity = typeof Quantity.Type;

/**
 * The canonical decimal string for an amount: what Postgres stores, what a
 * matching key compares, and what a digest hashes. `format` normalizes first,
 * so the string is independent of how the value happened to be represented and
 * `1.50` and `1.5` hash alike. `formatAud` is what an operator reads.
 */
export const formatMoney = (value: BigDecimal.BigDecimal) => BigDecimal.format(value);

export const Currency = Schema.String.check(Schema.isMinLength(1)).pipe(Schema.brand("Currency"));
export type Currency = typeof Currency.Type;

export const Asset = Schema.String.check(Schema.isMinLength(1)).pipe(Schema.brand("Asset"));
export type Asset = typeof Asset.Type;

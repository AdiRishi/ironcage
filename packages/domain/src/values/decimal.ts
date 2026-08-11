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

/** `numeric(24,8)`, wider in the integer part than `Money` for venue prices. */
export const Price = financialDecimal("Price", 24, 8);
export type Price = typeof Price.Type;

/** `numeric(38,18)`, sized for crypto asset quantities. */
export const Quantity = financialDecimal("Quantity", 38, 18);
export type Quantity = typeof Quantity.Type;

export const Currency = Schema.String.check(Schema.isMinLength(1)).pipe(Schema.brand("Currency"));
export type Currency = typeof Currency.Type;

export const Asset = Schema.String.check(Schema.isMinLength(1)).pipe(Schema.brand("Asset"));
export type Asset = typeof Asset.Type;

import { BigDecimal, Schema } from "effect";
import type { Brand } from "effect";

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

const financialDecimal = (precision: number, scale: number) =>
  Schema.BigDecimalFromString.check(fitsNumeric(precision, scale));

/**
 * `numeric(20,8)`, which Postgres caps just under 10^12 units.
 *
 * The currency is a phantom parameter: `Money<"AUD">` and `Money<"USD">` are
 * the same `BigDecimal` at runtime, and the brand alone stops them adding
 * together. Build each currency's schema once and share it.
 */
export const Money = <const C extends string>(currency: C) =>
  financialDecimal(20, 8).pipe(Schema.brand(`Money<${currency}>`));
export type Money<C extends string> = BigDecimal.BigDecimal & Brand.Brand<`Money<${C}>`>;

/** The home currency; the entire bank record and every analysis figure is AUD. */
export const Aud = Money("AUD");
export type Aud = Money<"AUD">;

/** `numeric(24,8)`, wider in the integer part than `Money` for venue prices. */
export const Price = financialDecimal(24, 8).pipe(Schema.brand("Price"));
export type Price = typeof Price.Type;

/** `numeric(38,18)`, sized for crypto asset quantities. */
export const Quantity = financialDecimal(38, 18).pipe(Schema.brand("Quantity"));
export type Quantity = typeof Quantity.Type;

export const Currency = Schema.String.check(Schema.isMinLength(1)).pipe(Schema.brand("Currency"));
export type Currency = typeof Currency.Type;

export const Asset = Schema.String.check(Schema.isMinLength(1)).pipe(Schema.brand("Asset"));
export type Asset = typeof Asset.Type;

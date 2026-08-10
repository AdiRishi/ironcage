import { Schema } from "effect";

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
const decimal = Schema.BigDecimalFromString;

/** `numeric(20,8)`, which Postgres caps just under 10^12 units. */
export const Money = decimal;
export type Money = typeof Money.Type;

/** `numeric(24,8)`, wider in the integer part than `Money` for venue prices. */
export const Price = decimal;
export type Price = typeof Price.Type;

/** `numeric(38,18)`, sized for crypto asset quantities. */
export const Quantity = decimal;
export type Quantity = typeof Quantity.Type;

export const Currency = Schema.String.check(Schema.isMinLength(1)).pipe(Schema.brand("Currency"));
export type Currency = typeof Currency.Type;

export const Asset = Schema.String.check(Schema.isMinLength(1)).pipe(Schema.brand("Asset"));
export type Asset = typeof Asset.Type;

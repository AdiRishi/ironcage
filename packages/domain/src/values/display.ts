import { BigDecimal } from "effect";

import type { CalendarDate, CalendarMonth } from "./calendar";
import type { Money } from "./decimal";

/**
 * How a stored value is written for a person to read. `formatMoney` is the
 * other half of the pair: it produces the canonical machine string a key
 * compares and a digest hashes, and it is deliberately not this.
 *
 * Everything here lives in the domain rather than beside a surface because the
 * rendered monthly report and the operator's screen must agree to the cent. Two
 * implementations of "what does A$1,954.80 look like" is one implementation too
 * many, and the one that drifted read `A$1954.8`.
 */
const aud = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Display rounding is half-even at the currency's minor unit, per
 * `docs/technical/02-domain.md`. The rounding happens on the `BigDecimal`, so
 * the number reaching `Intl` is already the two-decimal figure being shown and
 * no float ever decides what a value rounds to.
 */
export const formatAud = (value: Money) =>
  aud.format(BigDecimal.toNumberUnsafe(BigDecimal.round(value, { scale: 2, mode: "half-even" })));

/** The same, signed the way a ledger reads: a credit carries its plus. */
export const formatSignedAud = (value: Money) =>
  BigDecimal.isPositive(value) ? `+${formatAud(value)}` : formatAud(value);

const rate = new Intl.NumberFormat("en-AU", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** A ratio as a percentage. The caller passes the ratio; the scaling is here. */
export const formatRate = (value: BigDecimal.BigDecimal) =>
  rate.format(BigDecimal.toNumberUnsafe(BigDecimal.round(value, { scale: 4, mode: "half-even" })));

const month = new Intl.DateTimeFormat("en-AU", { month: "long", year: "numeric", timeZone: "UTC" });
const day = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", timeZone: "UTC" });
const fullDay = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export const formatMonth = (value: CalendarMonth) =>
  month.format(new Date(`${value}-01T00:00:00Z`));

export const formatDay = (value: CalendarDate) => day.format(new Date(`${value}T00:00:00Z`));

export const formatFullDay = (value: CalendarDate) =>
  fullDay.format(new Date(`${value}T00:00:00Z`));

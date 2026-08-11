import { type CalendarDate, type CalendarMonth, type Money } from "@ironcage/domain";
import { BigDecimal } from "effect";

const audFormat = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Display rounding is half-even at the currency's minor unit, per
 * `docs/technical/02-domain.md`. The rounding happens on the `BigDecimal`; the
 * number that reaches `Intl` is already the two-decimal value being shown, so
 * no float ever decides what a figure rounds to.
 */
export const aud = (value: Money) =>
  audFormat.format(
    BigDecimal.toNumberUnsafe(BigDecimal.round(value, { scale: 2, mode: "half-even" })),
  );

/** The same, signed the way a ledger reads: a credit carries its plus. */
export const signedAud = (value: Money) =>
  BigDecimal.isPositive(value) ? `+${aud(value)}` : aud(value);

export const percent = (value: BigDecimal.BigDecimal) =>
  `${BigDecimal.format(BigDecimal.round(BigDecimal.multiply(value, BigDecimal.fromBigInt(100n)), { scale: 1, mode: "half-even" }))}%`;

const monthFormat = new Intl.DateTimeFormat("en-AU", { month: "long", year: "numeric" });
const dayFormat = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short" });
const fullDayFormat = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export const monthLabel = (month: CalendarMonth) =>
  monthFormat.format(new Date(`${month}-01T00:00:00Z`));

export const dayLabel = (date: CalendarDate) => dayFormat.format(new Date(`${date}T00:00:00Z`));

export const fullDayLabel = (date: CalendarDate) =>
  fullDayFormat.format(new Date(`${date}T00:00:00Z`));

/** A digest is identity, not prose: the first twelve characters identify it on screen. */
export const shortDigest = (digest: string) => digest.slice(0, 12);

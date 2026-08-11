import { Money } from "@ironcage/domain";
import { Option, Schema } from "effect";

/**
 * A calendar date exactly as a bank source wrote it, normalized to ISO-8601.
 *
 * Every observed CommBank source — CSV cells, OFX `DTPOSTED`, statement rows —
 * carries a date and no transaction time, which is why deduplication can never
 * match on a timestamp. Keeping that fact in the type stops a later reader from
 * assuming an instant exists.
 */
export const SourceDate = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/)).pipe(
  Schema.brand("SourceDate"),
);
export type SourceDate = typeof SourceDate.Type;

const toSourceDate = Schema.decodeUnknownSync(SourceDate);
const toMoney = Schema.decodeUnknownOption(Money);

const pad = (value: number, width: number) => String(value).padStart(width, "0");

/**
 * Builds a `SourceDate` from calendar parts, rejecting a date that does not
 * exist. `31/02/2032` parses as three integers under any regular expression, so
 * the round trip through the calendar is what actually refuses it.
 */
export const sourceDate = (year: number, month: number, day: number): Option.Option<SourceDate> => {
  const date = new Date(Date.UTC(year, month - 1, day));

  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? Option.some(toSourceDate(`${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`))
    : Option.none();
};

/**
 * The only decimal shape any observed export writes: an optional sign, digits,
 * and an optional fractional part.
 *
 * `BigDecimal` accepts more than that — the empty string decodes as zero and
 * `1e5` decodes as 100000 — so the shape is checked before the value is parsed.
 * An empty amount cell silently becoming A$0.00 is exactly the class of failure
 * the import boundary exists to prevent.
 */
const decimalShape = /^[+-]?\d+(?:\.\d+)?$/;

export const sourceAmount = (raw: string): Option.Option<Money> =>
  decimalShape.test(raw) ? toMoney(raw) : Option.none();

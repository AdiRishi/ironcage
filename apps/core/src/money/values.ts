import { Money } from "@ironcage/domain";
import { DateTime, Option, Schema } from "effect";

const sourceDatePattern = /^\d{4}-\d{2}-\d{2}$/;

const isCalendarDate = Schema.makeFilter<string>(
  (value) => {
    if (!sourceDatePattern.test(value)) return false;

    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(5, 7));
    const day = Number(value.slice(8, 10));
    const date = DateTime.make({ year, month, day });

    return year > 0 && Option.isSome(date) && DateTime.formatIsoDateUtc(date.value) === value;
  },
  { expected: "a valid ISO-8601 calendar date" },
);

export const SourceDate = Schema.String.check(
  Schema.isPattern(sourceDatePattern),
  isCalendarDate,
).pipe(Schema.brand("SourceDate"));
export type SourceDate = typeof SourceDate.Type;

const decodeSourceDate = Schema.decodeUnknownOption(SourceDate);
const decodeMoney = Schema.decodeUnknownOption(Money);
const decimalShape = /^[+-]?\d+(?:\.\d+)?$/;

const pad = (value: number, width: number) => String(value).padStart(width, "0");

export const sourceDate = (year: number, month: number, day: number): Option.Option<SourceDate> =>
  decodeSourceDate(`${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`);

export const sourceAmount = (raw: string): Option.Option<Money> =>
  decimalShape.test(raw) ? decodeMoney(raw) : Option.none();

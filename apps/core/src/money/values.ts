import { CalendarDate, Money } from "@ironcage/domain";
import { Option, Schema } from "effect";

export type SourceDate = CalendarDate;

const decodeSourceDate = Schema.decodeUnknownOption(CalendarDate);
const decodeMoney = Schema.decodeUnknownOption(Money);
const decimalShape = /^[+-]?\d+(?:\.\d+)?$/;

const pad = (value: number, width: number) => String(value).padStart(width, "0");

export const sourceDate = (year: number, month: number, day: number): Option.Option<SourceDate> =>
  decodeSourceDate(`${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`);

export const sourceAmount = (raw: string): Option.Option<Money> =>
  decimalShape.test(raw) ? decodeMoney(raw) : Option.none();

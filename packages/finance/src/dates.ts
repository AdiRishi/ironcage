import { CalendarDate, FinanceError, YearMonth } from "@repo/contracts/finance";
import { DateTime, Effect, Schema } from "effect";

export const parseCalendarDate = Effect.fnUntraced(function* (text: string) {
  return yield* Schema.decodeEffect(CalendarDate)(text).pipe(
    Effect.mapError(() => new FinanceError({ kind: "invalid", message: "Invalid calendar date." })),
  );
});
export const parseBankDate = Effect.fnUntraced(function* (text: string) {
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(text))
    return yield* new FinanceError({ kind: "invalid", message: "Expected DD/MM/YYYY." });
  return yield* parseCalendarDate(`${text.slice(6)}-${text.slice(3, 5)}-${text.slice(0, 2)}`);
});

export function addDays(on: CalendarDate, days: number) {
  return CalendarDate.make(
    DateTime.formatIsoDateUtc(DateTime.add(DateTime.makeUnsafe(on), { days })),
  );
}
// The date an instant falls on in a timezone, such as today in the settings timezone.
export function calendarDateIn(instant: DateTime.DateTime, timezone: string) {
  return CalendarDate.make(DateTime.formatIsoDate(DateTime.setZoneNamedUnsafe(instant, timezone)));
}

const monthIndex = (month: YearMonth) =>
  Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;

export function yearMonthOf(on: CalendarDate) {
  return YearMonth.make(on.slice(0, 7));
}
export function yearMonthStart(month: YearMonth) {
  return CalendarDate.make(`${month}-01`);
}
export function shiftYearMonth(month: YearMonth, months: number) {
  const index = monthIndex(month) + months;
  const year = String(Math.floor(index / 12)).padStart(4, "0");
  return YearMonth.make(`${year}-${String((index % 12) + 1).padStart(2, "0")}`);
}
// How many months `from` through `to` span, counting both.
export function monthCount(from: YearMonth, to: YearMonth) {
  return monthIndex(to) - monthIndex(from) + 1;
}

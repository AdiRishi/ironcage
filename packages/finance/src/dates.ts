import { CalendarDate, FinanceError } from "@repo/contracts/finance";
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

export const nextCalendarDate = (on: CalendarDate) =>
  CalendarDate.make(DateTime.formatIsoDateUtc(DateTime.add(DateTime.makeUnsafe(on), { days: 1 })));

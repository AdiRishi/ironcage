import { CalendarDate, FinanceError } from "@repo/contracts/finance";
import { Effect, Schema } from "effect";

export const parseCalendarDate = Effect.fn("parseCalendarDate")(function* (text: string) {
  return yield* Schema.decodeUnknownEffect(CalendarDate)(text).pipe(
    Effect.mapError(() => new FinanceError({ kind: "invalid", message: "Invalid calendar date." })),
  );
});
export const parseBankDate = Effect.fn("parseBankDate")(function* (text: string) {
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(text))
    return yield* new FinanceError({ kind: "invalid", message: "Expected DD/MM/YYYY." });
  return yield* parseCalendarDate(`${text.slice(6)}-${text.slice(3, 5)}-${text.slice(0, 2)}`);
});

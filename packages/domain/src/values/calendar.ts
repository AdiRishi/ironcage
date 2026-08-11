import { DateTime, Option, Schema } from "effect";

const calendarDatePattern = /^\d{4}-\d{2}-\d{2}$/;

const isCalendarDate = Schema.makeFilter<string>(
  (value) => {
    if (!calendarDatePattern.test(value)) return false;

    const date = DateTime.make({
      year: Number(value.slice(0, 4)),
      month: Number(value.slice(5, 7)),
      day: Number(value.slice(8, 10)),
    });

    return Option.isSome(date) && DateTime.formatIsoDateUtc(date.value) === value;
  },
  { expected: "a valid ISO-8601 calendar date" },
);

export const CalendarDate = Schema.String.check(
  Schema.isPattern(calendarDatePattern),
  isCalendarDate,
).pipe(Schema.brand("CalendarDate"));
export type CalendarDate = typeof CalendarDate.Type;

const calendarMonthPattern = /^\d{4}-(?:0[1-9]|1[0-2])$/;

export const CalendarMonth = Schema.String.check(Schema.isPattern(calendarMonthPattern)).pipe(
  Schema.brand("CalendarMonth"),
);
export type CalendarMonth = typeof CalendarMonth.Type;

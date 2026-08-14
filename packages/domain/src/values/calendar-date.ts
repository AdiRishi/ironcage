import { Schema } from "effect";

/**
 * A calendar date with no instant attached — one of the two deliberate
 * non-instant exceptions in the time conventions: bank posting dates are what
 * the bank printed, not a moment that shifts with a time zone.
 *
 * Postgres `date` crosses the driver as its ISO text form (the persistence
 * layer registers a passthrough parser), and the same string form travels in
 * JSON, so one schema serves both boundaries.
 */
export const CalendarDate = Schema.String.check(
  Schema.makeFilter<string>(
    (value) => {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
      if (match === null) return false;
      const [, year, month, day] = match;
      const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
      return (
        date.getUTCFullYear() === Number(year) &&
        date.getUTCMonth() === Number(month) - 1 &&
        date.getUTCDate() === Number(day)
      );
    },
    { expected: "an ISO-8601 calendar date" },
  ),
).pipe(Schema.brand("CalendarDate"));
export type CalendarDate = typeof CalendarDate.Type;

const dayMillis = 86_400_000;

export const toEpochDay = (date: CalendarDate): number =>
  Date.parse(`${date}T00:00:00Z`) / dayMillis;

export const fromEpochDay = (day: number): CalendarDate =>
  new Date(day * dayMillis).toISOString().slice(0, 10) as CalendarDate;

export const addDays = (date: CalendarDate, days: number): CalendarDate =>
  fromEpochDay(toEpochDay(date) + days);

/** Signed whole days from `from` to `to`; positive when `to` is later. */
export const daysBetween = (from: CalendarDate, to: CalendarDate): number =>
  toEpochDay(to) - toEpochDay(from);

/** The `YYYY-MM` key ISO date strings sort and group by. */
export const monthOf = (date: CalendarDate): string => date.slice(0, 7);

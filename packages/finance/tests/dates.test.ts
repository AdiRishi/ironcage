import { expect, it } from "@effect/vitest";
import { YearMonth } from "@repo/contracts/finance";
import { Effect } from "effect";

import { monthCount, parseBankDate, parseCalendarDate, shiftYearMonth } from "../src/dates.ts";

it.effect("preserves calendar dates and rejects impossible leap days", () =>
  Effect.gen(function* () {
    expect(yield* parseBankDate("29/02/2024")).toBe("2024-02-29");
    expect(yield* parseBankDate("01/09/2026")).toBe("2026-09-01");
    for (const date of ["2025-02-29", "1900-02-29", "2026-04-31", "2026-13-01", "0000-01-01"]) {
      expect((yield* Effect.flip(parseCalendarDate(date))).kind).toBe("invalid");
    }
  }),
);

it("counts and shifts months across year ends", () => {
  const month = (value: string) => YearMonth.make(value);
  expect(shiftYearMonth(month("2026-01"), -1)).toBe("2025-12");
  expect(shiftYearMonth(month("2025-11"), 14)).toBe("2027-01");
  expect(monthCount(month("2025-11"), month("2026-02"))).toBe(4);
  expect(monthCount(month("2026-08"), month("2026-08"))).toBe(1);
});

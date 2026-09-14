import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { parseBankDate, parseCalendarDate } from "../src/dates.ts";

it.effect("preserves calendar dates and rejects impossible leap days", () =>
  Effect.gen(function* () {
    expect(yield* parseBankDate("29/02/2024")).toBe("2024-02-29");
    expect(yield* parseBankDate("01/09/2026")).toBe("2026-09-01");
    for (const date of ["2025-02-29", "1900-02-29", "2026-04-31", "2026-13-01", "0000-01-01"]) {
      expect((yield* Effect.flip(parseCalendarDate(date))).kind).toBe("invalid");
    }
  }),
);

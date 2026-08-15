import { Schema } from "effect";
import { describe, expect, test } from "vitest";

import { addDays, CalendarDate, daysBetween, monthOf } from "../../src";

const date = Schema.decodeUnknownSync(CalendarDate);

describe("calendar date", () => {
  test("accepts only real ISO dates", () => {
    expect(date("0001-01-01")).toBe("0001-01-01");
    expect(date("2032-02-29")).toBe("2032-02-29");
    expect(() => date("2031-02-29")).toThrow(/calendar date/);
    expect(() => date("2032-13-01")).toThrow(/calendar date/);
    expect(() => date("2032-01-00")).toThrow(/calendar date/);
    expect(() => date("29/01/2032")).toThrow(/calendar date/);
  });

  test("day arithmetic crosses month and year boundaries", () => {
    expect(addDays(date("2031-12-29"), 5)).toBe("2032-01-03");
    expect(addDays(date("2032-03-01"), -1)).toBe("2032-02-29");
    expect(daysBetween(date("2031-12-11"), date("2032-01-29"))).toBe(49);
    expect(monthOf(date("2032-01-29"))).toBe("2032-01");
  });
});

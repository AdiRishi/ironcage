import {
  CalendarMonth,
  formatAud,
  formatMonth,
  formatRate,
  formatSignedAud,
  Money,
} from "@ironcage/domain";
import { BigDecimal, Schema } from "effect";
import { describe, expect, it } from "vitest";

const money = Schema.decodeUnknownSync(Money);
const month = Schema.decodeUnknownSync(CalendarMonth);

describe("money formatting", () => {
  it("rounds half-even at the minor unit", () => {
    expect(formatAud(money("1.005"))).toBe("$1.00");
    expect(formatAud(money("1.015"))).toBe("$1.02");
    expect(formatAud(money("-6285.755"))).toBe("-$6,285.76");
  });

  /**
   * A stored amount carries a trailing zero the canonical string drops. Reading
   * a report that says `$1954.8` is what this exists to prevent.
   */
  it("keeps both minor-unit digits and groups thousands", () => {
    expect(formatAud(money("1954.80"))).toBe("$1,954.80");
    expect(formatAud(money("100"))).toBe("$100.00");
    expect(formatAud(money("-631422.56"))).toBe("-$631,422.56");
  });

  it("signs a credit so a ledger reads at a glance", () => {
    expect(formatSignedAud(money("50.09"))).toBe("+$50.09");
    expect(formatSignedAud(money("-6.2"))).toBe("-$6.20");
  });

  it("renders a savings rate as a percentage of one decimal", () => {
    expect(formatRate(BigDecimal.fromStringUnsafe("0.9638"))).toBe("96.4%");
    expect(formatRate(BigDecimal.fromStringUnsafe("0.64"))).toBe("64.0%");
  });

  it("names a month rather than printing its key", () => {
    expect(formatMonth(month("2026-07"))).toBe("July 2026");
  });
});

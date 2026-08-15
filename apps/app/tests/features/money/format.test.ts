import { CoverageSpan } from "@ironcage/contracts/schema";
import { Aud, CalendarDate } from "@ironcage/domain";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  cadenceLabel,
  formatAud,
  formatMonth,
  formatRate,
  formatSpan,
} from "@/features/money/format";

const aud = Schema.decodeUnknownSync(Aud);
const day = Schema.decodeUnknownSync(CalendarDate);
const span = Schema.decodeUnknownSync(CoverageSpan);

describe("formatAud", () => {
  it("groups digits and pads cents", () => {
    expect(formatAud(aud("1954.8"))).toBe("A$1,954.80");
    expect(formatAud(aud("1234567.05"))).toBe("A$1,234,567.05");
  });

  it("marks debits with a typographic minus and credits only on request", () => {
    expect(formatAud(aud("-45.2"))).toBe("−A$45.20");
    expect(formatAud(aud("100"), { sign: "always" })).toBe("+A$100.00");
    expect(formatAud(aud("-45.2"), { sign: "none" })).toBe("A$45.20");
  });

  it("renders a numeric(20,8) extreme without precision loss", () => {
    expect(formatAud(aud("999999999999.12345678"))).toBe("A$999,999,999,999.12");
  });

  it("rounds sub-cent amounts half-even", () => {
    expect(formatAud(aud("10.005"))).toBe("A$10.00");
    expect(formatAud(aud("10.015"))).toBe("A$10.02");
  });
});

describe("dates and rates", () => {
  it("formats months, days, and spans in the operator's locale", () => {
    expect(formatMonth("2025-07")).toBe("July 2025");
    // en-AU never abbreviates June and July.
    expect(formatSpan(span({ start: day("2025-07-01"), end: day("2025-08-05") }))).toBe(
      "1 July – 5 Aug 2025",
    );
    expect(formatSpan(span({ start: day("2024-12-29"), end: day("2025-01-03") }))).toBe(
      "29 Dec 2024 – 3 Jan 2025",
    );
  });

  it("formats a savings rate to whole percent", () => {
    expect(formatRate("0.6400")).toBe("64%");
  });
});

describe("cadenceLabel", () => {
  it("names the analysis cadence buckets and falls back to days", () => {
    expect(cadenceLabel(30)).toBe("Monthly");
    expect(cadenceLabel(33)).toBe("Monthly");
    expect(cadenceLabel(7)).toBe("Weekly");
    expect(cadenceLabel(365)).toBe("Yearly");
    expect(cadenceLabel(50)).toBe("Every 50 days");
  });
});

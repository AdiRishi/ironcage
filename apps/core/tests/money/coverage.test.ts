import type { CalendarDate } from "@ironcage/domain";
import { describe, expect, test } from "vitest";

import {
  completeMonths,
  coverageGaps,
  mergeSpans,
  monthCompleteForAccount,
  monthsBetween,
} from "../../src/money/import/coverage";

const span = (start: string, end: string) => ({
  start: start as CalendarDate,
  end: end as CalendarDate,
});

describe("coverage", () => {
  test("overlapping and adjacent segments merge; separated ones do not", () => {
    expect(
      mergeSpans([
        span("2032-01-05", "2032-01-29"),
        span("2031-12-11", "2032-01-29"),
        span("2032-01-30", "2032-02-10"),
        span("2032-02-20", "2032-02-25"),
      ]),
    ).toEqual([span("2031-12-11", "2032-02-10"), span("2032-02-20", "2032-02-25")]);
  });

  test("gaps are the exact complement of the union", () => {
    const merged = mergeSpans([span("2032-01-01", "2032-01-10"), span("2032-01-20", "2032-01-25")]);

    expect(coverageGaps(merged, span("2032-01-01", "2032-01-31"))).toEqual([
      span("2032-01-11", "2032-01-19"),
      span("2032-01-26", "2032-01-31"),
    ]);
    expect(coverageGaps(merged, span("2032-01-02", "2032-01-09"))).toEqual([]);
  });

  test("a truncated window creates no complete-month claim", () => {
    const merged = mergeSpans([span("2032-01-01", "2032-01-30")]);

    expect(monthCompleteForAccount(merged, "2032-01", { openedOn: null, closedOn: null })).toBe(
      false,
    );
  });

  test("an account is not required outside its life", () => {
    const merged = mergeSpans([span("2032-01-15", "2032-01-31")]);

    expect(
      monthCompleteForAccount(merged, "2032-01", {
        openedOn: "2032-01-15" as CalendarDate,
        closedOn: null,
      }),
    ).toBe(true);
    expect(
      monthCompleteForAccount(merged, "2031-12", {
        openedOn: "2032-01-15" as CalendarDate,
        closedOn: null,
      }),
    ).toBe(true);
  });

  test("a Money month requires every required account in full", () => {
    const covered = {
      merged: mergeSpans([span("2031-12-01", "2032-02-29")]),
      life: { openedOn: null, closedOn: null },
    };
    const gappy = {
      merged: mergeSpans([span("2031-12-01", "2032-01-14"), span("2032-01-16", "2032-02-29")]),
      life: { openedOn: null, closedOn: null },
    };

    expect(completeMonths([covered, gappy], ["2031-12", "2032-01", "2032-02"])).toEqual(
      new Set(["2031-12", "2032-02"]),
    );
  });

  test("monthsBetween spans year boundaries inclusively", () => {
    expect(monthsBetween("2031-11-15" as CalendarDate, "2032-02-01" as CalendarDate)).toEqual([
      "2031-11",
      "2031-12",
      "2032-01",
      "2032-02",
    ]);
  });
});

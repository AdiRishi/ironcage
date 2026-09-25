import { describe, expect, it } from "@effect/vitest";
import { FigureId, RecordId } from "@repo/contracts/analyst";
import { CalendarDate } from "@repo/contracts/finance";

import { checkAnswer } from "../../src/answers/check.ts";

// A turn that read August 2026 against July, over an account labelled with the last digits
// of its number, and a counterparty whose name holds a digit.
const evidence = {
  figures: [FigureId.make("f1"), FigureId.make("f2")].map((id) => ({ id })),
  records: [{ id: RecordId.make("r3") }],
  names: ["CommBank card 5678", "7-Eleven"],
  periods: [
    { start: CalendarDate.make("2026-08-01"), endExclusive: CalendarDate.make("2026-09-01") },
    { start: CalendarDate.make("2026-07-01"), endExclusive: CalendarDate.make("2026-08-01") },
  ],
};

describe("checkAnswer", () => {
  it("accepts figures and records the turn returned, with dates written out", () => {
    expect(
      checkAnswer(
        "Dining out rose [[f1]] to [[f2]] on 12 August 2026, most of it at [[r3]].\n\n" +
          "- Your records for 1 to 10 August are complete.\n" +
          "- The Mastercard statement for 11 to 31 August 2026 is missing.",
        evidence,
      ),
    ).toEqual([]);
  });

  it.each([
    "1 to 25 August 2026",
    "3 March to 14 April 2026",
    "28 December 2025 to 3 January 2026",
    "March to May 2026",
    "August 12",
    "2026-08-12",
    "2026",
  ])("accepts the date %s", (period) => {
    expect(checkAnswer(`Spending on ${period} was [[f1]].`, evidence)).toEqual([]);
  });

  it("accepts the names the tools returned, digits and all", () => {
    expect(
      checkAnswer(
        "Most of it went through CommBank card 5678, and [[f1]] was at 7-Eleven in August 2026.",
        evidence,
      ),
    ).toEqual([]);
  });

  it.each([
    { text: "Dining out cost $123.45 more.", found: "$123.45" },
    { text: "You spent 2000 dollars on food.", found: '"2000 dollars"' },
    { text: "Dining out rose 12%.", found: "12%" },
    { text: "Dining out rose [[f9]].", found: "[[f9]]" },
    { text: "You paid [[r7]] twice.", found: "[[r7]]" },
    { text: "Dining out came to [[total]].", found: "[[total]]" },
    { text: "You had 3 dinners out.", found: '"3"' },
    { text: "You spent 1999 on rent.", found: '"1999"' },
    { text: "Rent is 2050 a month.", found: '"2050"' },
    { text: "It cost a thousand dollars.", found: '"thousand"' },
    { text: "August cost more because of three restaurant dinners.", found: '"three"' },
    { text: "See https://example.com/ledger for more.", found: "https://example.com/ledger" },
    { text: "See [the ledger](/ledger) for more.", found: "[the ledger](/ledger)" },
    {
      text: "![chart](https://example.com/chart.png)",
      found: "![chart](https://example.com/chart.png)",
    },
  ])("rejects $found in an answer", ({ text, found }) => {
    const problems = checkAnswer(text, evidence);
    expect(problems.filter((problem) => problem.includes(found))).toHaveLength(1);
  });

  it("names every number an answer writes in words", () => {
    expect(checkAnswer("You had three dinners out and twelve coffees.", evidence)).toEqual([
      '"three" writes a number in words. Cite the figure that holds it, or leave the number out.',
      '"twelve" writes a number in words. Cite the figure that holds it, or leave the number out.',
    ]);
  });
});

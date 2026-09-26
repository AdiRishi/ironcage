import { expect, it } from "@effect/vitest";

import { figureText } from "../src/figures.ts";

const aud = (minor: bigint) => ({ currency: "AUD", minor });

it("shows a change with its sign and an amount without one", () => {
  expect(figureText({ kind: "money", amount: aud(31000n), signed: true })).toBe("+$310.00");
  expect(figureText({ kind: "money", amount: aud(-4050n), signed: true })).toBe("−$40.50");
  expect(figureText({ kind: "money", amount: aud(72000n), signed: false })).toBe("$720.00");
});

it("names a count's unit, singular for one", () => {
  expect(figureText({ kind: "count", count: 1, unit: "purchase" })).toBe("1 purchase");
  expect(figureText({ kind: "count", count: 3, unit: "question" })).toBe("3 questions");
});

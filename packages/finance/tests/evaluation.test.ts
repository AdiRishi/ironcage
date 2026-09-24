import { describe, expect, it } from "@effect/vitest";

import { sameName, scoreEvaluation } from "../src/index.ts";

const answer = (
  name: string,
  categoryKey: string | null,
  topCategoryKey = categoryKey?.split(".")[0] ?? null,
) => ({
  name,
  kind: "business" as const,
  categoryKey,
  topCategoryKey,
});

describe("sameName", () => {
  it("ignores case, order, punctuation, and legal suffixes but not different words", () => {
    expect(sameName("WOOLWORTHS PTY LTD", "Woolworths")).toBe(true);
    expect(sameName("Smith, Jane", "Jane Smith")).toBe(true);
    expect(sameName("Uber Eats", "Uber")).toBe(false);
  });
});

describe("scoreEvaluation", () => {
  it("counts agreement per field and how often confident answers were right", () => {
    const score = scoreEvaluation({
      threshold: 0.8,
      rows: [
        // Right, confident.
        {
          expected: answer("Woolworths", "food.groceries"),
          predicted: {
            ...answer("Woolworths Metro", "food.groceries"),
            name: "WOOLWORTHS",
            confidence: 0.95,
          },
        },
        // Right name, wrong subcategory in the right top-level category, confident.
        {
          expected: answer("Bunnings", "shopping.home"),
          predicted: { ...answer("Bunnings", "housing.maintenance", "shopping"), confidence: 0.85 },
        },
        // Wrong name, unsure.
        {
          expected: answer("Blue Bottle Coffee", "food.coffee"),
          predicted: { ...answer("Blue Market", "food.coffee"), confidence: 0.4 },
        },
        // No answer.
        { expected: answer("Jane Smith", "housing.rent"), predicted: null },
      ],
    });
    expect(score).toMatchObject({
      asked: 4,
      answered: 3,
      name: 2,
      kind: 3,
      category: 2,
      topCategory: 3,
      confident: 2,
      confidentRight: 1,
    });
    expect(score.bands.map((band) => [band.from, band.answered, band.right])).toEqual([
      [0, 1, 0],
      [0.5, 0, 0],
      [0.7, 0, 0],
      [0.8, 1, 0],
      [0.9, 1, 1],
    ]);
  });
});

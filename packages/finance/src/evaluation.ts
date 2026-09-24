import type { EvaluationAnswer, EvaluationScore } from "@repo/contracts/finance";

// Words that name the same business or person whatever their order or legal suffix:
// "WOOLWORTHS PTY LTD" and "Woolworths" agree, "Uber Eats" and "Uber" do not.
const ignored = new Set(["the", "pty", "ltd", "limited", "inc", "co", "au", "australia"]);
const nameWords = (name: string) =>
  name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0 && !ignored.has(word))
    .toSorted()
    .join(" ");
export const sameName = (a: string, b: string) => nameWords(a) === nameWords(b);

const bandEdges = [0, 0.5, 0.7, 0.8, 0.9, 1];

// Scores the model's answers against yours. An answer is right when it names the same
// counterparty and category, which is what the model's confidence claims.
export function scoreEvaluation({
  rows,
  threshold,
}: {
  rows: readonly {
    expected: typeof EvaluationAnswer.Type;
    predicted: (typeof EvaluationAnswer.Type & { confidence: number }) | null;
  }[];
  threshold: number;
}): typeof EvaluationScore.Type {
  const answered = rows.flatMap((row) =>
    row.predicted ? [{ expected: row.expected, predicted: row.predicted }] : [],
  );
  const right = (row: (typeof answered)[number]) =>
    sameName(row.expected.name, row.predicted.name) &&
    row.expected.categoryKey === row.predicted.categoryKey;
  const count = (test: (row: (typeof answered)[number]) => boolean) => answered.filter(test).length;
  const confident = answered.filter((row) => row.predicted.confidence >= threshold);
  return {
    asked: rows.length,
    answered: answered.length,
    name: count((row) => sameName(row.expected.name, row.predicted.name)),
    kind: count((row) => row.expected.kind === row.predicted.kind),
    category: count((row) => row.expected.categoryKey === row.predicted.categoryKey),
    topCategory: count((row) => row.expected.topCategoryKey === row.predicted.topCategoryKey),
    bands: bandEdges.slice(0, -1).map((from, index) => {
      const to = bandEdges[index + 1] ?? 1;
      const inBand = answered.filter(
        (row) =>
          row.predicted.confidence >= from &&
          (to === 1 ? row.predicted.confidence <= to : row.predicted.confidence < to),
      );
      return { from, to, answered: inBand.length, right: inBand.filter(right).length };
    }),
    threshold,
    confident: confident.length,
    confidentRight: confident.filter(right).length,
  };
}

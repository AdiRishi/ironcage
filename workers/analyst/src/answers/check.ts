import { answerSegments, type Figure, type RecordRef } from "@repo/contracts/analyst";
import type { Period } from "@repo/contracts/finance";
import { addDays } from "@repo/finance";

const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "Jun",
  "Jul",
  "Aug",
  "Sept",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
].join("|");
const day = String.raw`\d{1,2}(?:st|nd|rd|th)?`;
const year = String.raw`(?:19|20)\d{2}`;
const currencyCodes = "AUD|USD|EUR|GBP|NZD|JPY|CAD|SGD|HKD|CNY|CHF|INR";
const amount = String.raw`[−-]?\d[\d,]*(?:\.\d+)?`;

// What an answer may not write, in the order it is looked for. Each check takes out what
// it found, so text is reported once, as the first thing it is.
const links = [
  {
    pattern: /!?\[[^\]\n]*\]\([^)\n]*\)/g,
    problem: (found: string) =>
      `"${found}" is a markdown link or image. Answers cannot contain links.`,
  },
  {
    pattern: /\bhttps?:\/\/\S+|\bwww\.\S+/gi,
    problem: (found: string) => `"${found}" is a link. Answers cannot contain links.`,
  },
  {
    pattern: /\[\[[^\]\n]*\]\]/g,
    problem: (found: string) =>
      `"${found}" is not a figure or record token. Write tokens as the tools return them, such as [[f1]].`,
  },
];
const amounts = [
  {
    pattern: new RegExp(
      [
        String.raw`[$€£¥]\s?[−-]?(?:\d[\d,]*(?:\.\d+)?)?`,
        String.raw`\b(?:${currencyCodes})\s?${amount}`,
        String.raw`${amount}\s?(?:${currencyCodes}|dollars?|cents?|bucks?)\b`,
        String.raw`[−-]?\d[\d,]*\.\d{2}\b`,
      ].join("|"),
      "gi",
    ),
    problem: (found: string) =>
      `"${found}" writes an amount. Cite the figure that holds it instead.`,
  },
  {
    pattern: /[−-]?\d[\d,.]*\s?(?:%|per\s?cent\b)|%/gi,
    problem: (found: string) =>
      `"${found}" writes a percentage. Cite the figure that holds it instead.`,
  },
];
// Dates with the years that follow their months, such as 12 August 2026, 1 to 13 August,
// August 12, August 2026, and 2026-08-12.
const dates = new RegExp(
  [
    String.raw`\b\d{4}-\d{2}-\d{2}\b`,
    String.raw`\b${day}(?:\s*(?:-|–|to|and)\s*${day})?\s+(?:${monthNames})(?:\s+${year})?\b`,
    String.raw`\b(?:${monthNames})\s+${year}\b`,
    String.raw`\b(?:${monthNames})\s+${day}(?:,?\s+${year})?\b`,
  ].join("|"),
  "g",
);
const years = new RegExp(String.raw`\b${year}\b`, "g");
const numbers = [
  {
    pattern: new RegExp(
      String.raw`\b(?:${[
        "one",
        "two",
        "three",
        "four",
        "five",
        "six",
        "seven",
        "eight",
        "nine",
        "ten",
        "eleven",
        "twelve",
        "thirteen",
        "fourteen",
        "fifteen",
        "sixteen",
        "seventeen",
        "eighteen",
        "nineteen",
        "twenty",
        "thirty",
        "forty",
        "fifty",
        "sixty",
        "seventy",
        "eighty",
        "ninety",
        "hundreds?",
        "thousands?",
        "millions?",
        "billions?",
        "dozens?",
        "twice",
        "double",
        "half",
      ].join("|")})\b`,
      "gi",
    ),
    problem: (found: string) =>
      `"${found}" writes a number in words. Cite the figure that holds it, or leave the number out.`,
  },
  {
    pattern: /\d[\d,.]*/g,
    problem: (found: string) =>
      `"${found}" writes a number. Cite the figure that holds it, or leave the number out.`,
  },
];

// The problems that keep an answer from being shown, as the model should read them: a
// token no tool returned in this turn, a link, or a number the answer writes itself, in
// digits or in words, instead of citing a figure. Dates may be written, with a year after
// the month, and a year may stand alone when a period the turn read covers it. The names
// the tools returned, such as an account labelled with the last digits of its number,
// may be written as they are.
export function checkAnswer(
  text: string,
  evidence: {
    readonly figures: ReadonlyArray<Pick<Figure, "id">>;
    readonly records: ReadonlyArray<Pick<RecordRef, "id">>;
    readonly names: ReadonlyArray<string>;
    readonly periods: ReadonlyArray<Period>;
  },
): ReadonlyArray<string> {
  const figures = new Set(evidence.figures.map((figure) => figure.id));
  const records = new Set(evidence.records.map((record) => record.id));
  const covered = new Set(
    evidence.periods.flatMap(({ start, endExclusive }) => {
      const first = Number(start.slice(0, 4));
      const last = Number(addDays(endExclusive, -1).slice(0, 4));
      return Array.from({ length: last - first + 1 }, (_, index) => first + index);
    }),
  );
  const problems: Array<string> = [];
  const texts: Array<string> = [];
  for (const segment of answerSegments(text)) {
    if (segment.kind === "text") texts.push(segment.text);
    else if (segment.kind === "figure" && !figures.has(segment.id))
      problems.push(
        `[[${segment.id}]] is not a figure any tool returned in this turn. Cite only those.`,
      );
    else if (segment.kind === "record" && !records.has(segment.id))
      problems.push(
        `[[${segment.id}]] is not a record any tool returned in this turn. Cite only those.`,
      );
  }
  let rest = texts.join("\n");
  const find = (checks: ReadonlyArray<(typeof links)[number]>) => {
    for (const { pattern, problem } of checks) {
      for (const [found] of rest.matchAll(pattern)) problems.push(problem(found.trim()));
      rest = rest.replace(pattern, " ");
    }
  };
  find(links);
  for (const name of evidence.names.toSorted((a, b) => b.length - a.length))
    rest = rest.replaceAll(name, " ");
  find(amounts);
  rest = rest
    .replace(dates, " ")
    .replace(years, (found) => (covered.has(Number(found)) ? " " : found));
  find(numbers);
  return [...new Set(problems)];
}

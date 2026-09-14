import { parseBankDate, parseMoney } from "@repo/finance";
import { Effect } from "effect";

export const parseDescription = Effect.fn("parseDescription")(function* (text: string) {
  const suffix = /\s+Value Date:\s*(\d{2}\/\d{2}\/\d{4})$/.exec(text);
  const valueOn = suffix?.[1] ? yield* parseBankDate(suffix[1]) : null;
  const description = (suffix ? text.slice(0, suffix.index) : text).trim();
  const original = /\b([A-Z]{3})\s+(\d+\.\d{2})\b/.exec(description);
  const originalMoney =
    original?.[1] && original[2] ? yield* parseMoney(original[2], original[1]) : null;
  return { description, valueOn, originalMoney };
});

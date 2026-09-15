import { CalendarDate, FinanceError, type Money } from "@repo/contracts/finance";
import { parseBankDate, parseMoney } from "@repo/finance";
import { Effect } from "effect";

const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const dated = /^(\d{1,2})\s+([A-Za-z]{3,9})\b(?:\s+(\d{4}))?/;
export const fullDates = /\b(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})\b/g;
export const pdfDate = Effect.fn("pdfDate")(function* (
  literal: string,
  period: { start: CalendarDate | null; end: CalendarDate | null },
) {
  const match = dated.exec(literal.trim());
  const month = match ? months.indexOf(match[2]!.slice(0, 3).toLowerCase()) + 1 : 0;
  if (!match || month === 0)
    return yield* new FinanceError({
      kind: "invalid",
      message: `Unreadable statement date: ${literal.trim()}`,
    });
  const years = match[3]
    ? [match[3]]
    : [...new Set([period.start?.slice(0, 4), period.end?.slice(0, 4)])].filter(
        (year) => year !== undefined,
      );
  for (const year of years) {
    const result = yield* parseBankDate(
      `${match[1]?.padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`,
    ).pipe(Effect.result);
    if (
      result._tag === "Success" &&
      (!period.start || result.success >= period.start) &&
      (!period.end || result.success <= period.end)
    )
      return result.success;
  }
  return yield* new FinanceError({
    kind: "invalid",
    message: `Statement date outside the printed period: ${literal.trim()}`,
  });
});
export const pdfMoney = Effect.fn("pdfMoney")(function* (
  literal: string,
  liability = false,
  decimalGap = false,
) {
  let value = literal.trim();
  if (/^Nil$/i.test(value)) value = "0.00";
  const negative = /DR\s*$|^[−-]|-$/.test(value) || (liability && !/CR\s*$/.test(value));
  value = value
    .replace(/\s*(?:CR|DR|-)$/, "")
    .replace(/^[−-]/, "")
    .replace(/^\$\s*/, "")
    .trim();
  // CommBank card text places a space where the printed decimal point appears.
  if (decimalGap) value = value.replace(/(\d)\s+(\d{2})$/, "$1.$2");
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)\.\d{2}$/.test(value))
    return yield* new FinanceError({ kind: "invalid", message: "Invalid statement amount." });
  return yield* parseMoney(`${negative ? "-" : ""}${value.replaceAll(",", "")}`, "AUD");
});
export const absoluteMoney = (money: Money) => ({
  ...money,
  minor: money.minor < 0n ? -money.minor : money.minor,
});

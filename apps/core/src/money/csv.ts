import type { CalendarDate } from "@ironcage/domain";
import { BigDecimal, Effect } from "effect";

import { BankImportBlocked, blocked } from "./block";
import { decodeWindows1252 } from "./bytes";

/**
 * One parsed CSV row. `raw` keeps every cell exactly as decoded from the
 * source bytes; the typed fields exist beside it, never instead of it.
 */
export interface CsvRow {
  readonly ordinal: number;
  readonly raw: {
    readonly date: string;
    readonly amount: string;
    readonly narrative: string;
    readonly balance: string;
  };
  readonly postedDate: CalendarDate;
  readonly amount: BigDecimal.BigDecimal;
  readonly balance: BigDecimal.BigDecimal | null;
}

export type CsvBalancePolicy = "required" | "forbidden";

const fail = (row: number, detail: string) => blocked("CsvGrammar", `row ${row + 1}: ${detail}`);

/**
 * Strict RFC 4180 record reader. Records separate on CRLF only — a bare line
 * feed or carriage return anywhere blocks the file, including inside quotes,
 * because no observed export contains a multi-line cell and pairing against
 * OFX `MEMO` could not survive one.
 */
const readRecords = Effect.fn("readCsvRecords")(function* (text: string) {
  const records: string[][] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let closed = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;

    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
          closed = true;
        }
      } else if (character === "\r" || character === "\n") {
        return yield* fail(records.length, "line break inside a quoted cell");
      } else {
        cell += character;
      }
      continue;
    }

    switch (character) {
      case '"':
        if (cell.length > 0 || closed) {
          return yield* fail(records.length, "quote inside an unquoted cell");
        }
        quoted = true;
        continue;
      case ",":
        cells.push(cell);
        cell = "";
        closed = false;
        continue;
      case "\r":
        if (text[index + 1] !== "\n") {
          return yield* fail(records.length, "carriage return without a line feed");
        }
        cells.push(cell);
        records.push(cells);
        cells = [];
        cell = "";
        closed = false;
        index += 1;
        continue;
      case "\n":
        return yield* fail(records.length, "bare line feed; the profile requires CRLF");
      default:
        if (closed) return yield* fail(records.length, "text after a closing quote");
        cell += character;
        continue;
    }
  }

  if (quoted) return yield* fail(records.length, "unterminated quoted cell");
  if (cell.length > 0 || cells.length > 0) {
    return yield* fail(records.length, "final record is missing its CRLF terminator");
  }

  return records;
});

const datePattern = /^(\d{2})\/(\d{2})\/(\d{4})$/;

const parseRowDate = (raw: string, row: number) =>
  Effect.gen(function* () {
    const match = datePattern.exec(raw);
    if (match === null) return yield* fail(row, `"${raw}" is not a DD/MM/YYYY date`);
    const [, day, month, year] = match;
    const iso = `${year}-${month}-${day}`;
    const utc = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    if (utc.toISOString().slice(0, 10) !== iso) {
      return yield* fail(row, `"${raw}" is not a real calendar date`);
    }
    return iso as CalendarDate;
  });

const amountPattern = /^[+-]?\d+\.\d{2}$/;

const parseAmount = (
  raw: string,
  row: number,
  field: string,
): Effect.Effect<BigDecimal.BigDecimal, BankImportBlocked> =>
  amountPattern.test(raw)
    ? Effect.succeed(BigDecimal.fromStringUnsafe(raw))
    : fail(row, `${field} "${raw}" is not a signed decimal`);

/**
 * Parses a NetBank transaction CSV: headerless, four columns, CRLF, decoded
 * as Windows-1252. The balance policy comes from the account profile —
 * deposits and the home loan carry one on every row, Mastercard never does.
 */
export const parseBankCsv = Effect.fn("parseBankCsv")(function* (
  bytes: Uint8Array,
  balances: CsvBalancePolicy,
): Effect.fn.Return<readonly CsvRow[], BankImportBlocked> {
  const records = yield* readRecords(decodeWindows1252(bytes));
  const rows: CsvRow[] = [];

  for (const [ordinal, cells] of records.entries()) {
    if (cells.length !== 4) {
      return yield* fail(ordinal, `expected 4 cells, found ${cells.length}`);
    }
    const [date, amount, narrative, balance] = cells as [string, string, string, string];

    const postedDate = yield* parseRowDate(date, ordinal);
    const signedAmount = yield* parseAmount(amount, ordinal, "amount");

    if (balances === "forbidden" && balance !== "") {
      return yield* fail(ordinal, "the profile forbids a populated balance cell");
    }
    if (balances === "required" && balance === "") {
      return yield* fail(ordinal, "the profile requires a balance on every row");
    }

    rows.push({
      ordinal,
      raw: { date, amount, narrative, balance },
      postedDate,
      amount: signedAmount,
      balance: balance === "" ? null : yield* parseAmount(balance, ordinal, "balance"),
    });
  }

  return rows;
});

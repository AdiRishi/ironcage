import { CalendarDate } from "@ironcage/domain";
import { parse } from "csv-parse/sync";
import { BigDecimal, Effect, Schema } from "effect";

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

const readRecords = Effect.fn("readCsvRecords")(function* (text: string) {
  if (text.length > 0 && !text.endsWith("\r\n")) {
    return yield* fail(0, "final record is missing its CRLF terminator");
  }
  const records = yield* Effect.try({
    try: () =>
      parse(text, {
        bom: false,
        columns: false,
        delimiter: ",",
        encoding: "utf8",
        escape: '"',
        quote: '"',
        recordDelimiter: "\r\n",
        relaxColumnCount: false,
        relaxQuotes: false,
        skipEmptyLines: false,
      }) as string[][],
    catch: (cause) =>
      new BankImportBlocked({
        code: "CsvGrammar",
        detail: cause instanceof Error ? cause.message : "the CSV is not valid RFC 4180",
      }),
  });
  for (const [row, cells] of records.entries()) {
    if (cells.some((cell) => cell.includes("\r") || cell.includes("\n"))) {
      return yield* fail(row, "line break inside a quoted cell");
    }
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
    const decoded = yield* Effect.result(Schema.decodeUnknownEffect(CalendarDate)(iso));
    if (decoded._tag === "Failure") {
      return yield* fail(row, `"${raw}" is not a real calendar date`);
    }
    return decoded.success;
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

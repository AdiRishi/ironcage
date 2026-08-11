import type { Money } from "@ironcage/domain";
import { parse } from "csv-parse/sync";
import { Effect, Option, Schema } from "effect";

import { type SourceDate, sourceAmount, sourceDate } from "../values";
import type { CommBankAccountProfile, CommBankProfileId } from "./profiles";

/**
 * The observed NetBank CSV is headerless, CRLF-delimited, and four columns
 * wide on every account type:
 *
 * ```text
 * DD/MM/YYYY,"signed decimal","narrative","running balance or empty"
 * ```
 *
 * This decoder turns those bytes into rows and refuses everything else. It
 * proves nothing about identity, pairing, or coverage — the file it accepts is
 * still only a claim until the OFX beside it proves the account and the two
 * multisets pair row for row.
 */
export interface CommBankCsvRow {
  /** Zero-based position in the file, which is newest-first in every observed export. */
  readonly sourceOrdinal: number;
  /**
   * The four cells exactly as the file wrote them, unquoted and otherwise
   * untouched. Normalization produces new fields beside these; it never
   * replaces them.
   */
  readonly raw: {
    readonly date: string;
    readonly amount: string;
    readonly narrative: string;
    readonly balance: string;
  };
  readonly postedDate: SourceDate;
  readonly amount: Money;
  /** Absent on Mastercard, whose fourth cell is empty by profile. */
  readonly rowBalance: Option.Option<Money>;
}

export interface CommBankCsvFile {
  readonly profile: CommBankProfileId;
  readonly rows: readonly CommBankCsvRow[];
}

/**
 * One tag with a closed set of reasons, rather than a tag per failure. Every
 * reason is a refusal to interpret the file, and a caller that wants to report
 * which one reads the field.
 */
export class CommBankCsvRejected extends Schema.TaggedError<CommBankCsvRejected>()(
  "CommBankCsvRejected",
  {
    reason: Schema.Literals([
      "line_endings",
      "malformed_csv",
      "header_row",
      "column_count",
      "invalid_date",
      "invalid_amount",
      "unexpected_balance",
      "missing_balance",
      "invalid_balance",
    ]),
    /** The row that was refused, or `null` when the whole file was. */
    sourceOrdinal: Schema.NullOr(Schema.Int),
    detail: Schema.String,
  },
) {}

const reject = (
  reason: CommBankCsvRejected["reason"],
  detail: string,
  sourceOrdinal: number | null = null,
) => new CommBankCsvRejected({ reason, sourceOrdinal, detail });

const columns = 4;
const australianDate = /^(\d{2})\/(\d{2})\/(\d{4})$/;

export const decodeCommBankCsv = Effect.fn("decodeCommBankCsv")(function* (
  bytes: Uint8Array,
  profile: CommBankAccountProfile,
): Effect.fn.Return<CommBankCsvFile, CommBankCsvRejected> {
  const text = new TextDecoder("windows-1252").decode(bytes);

  // Checked before parsing so that a lone-LF file is named as such, rather than
  // arriving as one enormous row with the wrong column count.
  for (let index = text.indexOf("\n"); index !== -1; index = text.indexOf("\n", index + 1)) {
    if (text[index - 1] !== "\r") {
      return yield* reject("line_endings", `a line feed at offset ${index} has no carriage return`);
    }
  }

  const records = yield* Effect.try({
    // RFC 4180 quoting, not a split on commas: narratives are opaque source
    // cells and commas inside them must not change the row shape.
    try: () =>
      parse(text, {
        bom: false,
        columns: false,
        delimiter: ",",
        escape: '"',
        quote: '"',
        recordDelimiter: "\r\n",
        // The library would refuse an inconsistent row itself, but its refusal
        // arrives as a message. The width check below owns that rejection so
        // the reason and the row ordinal reach the operator as data.
        relaxColumnCount: true,
        relaxQuotes: false,
        skipEmptyLines: false,
        trim: false,
      }) as string[][],
    catch: (cause) => reject("malformed_csv", String(cause)),
  });

  const first = records[0]?.[0];

  if (first !== undefined && /^[A-Za-z]/.test(first)) {
    return yield* reject("header_row", `the first row begins with ${JSON.stringify(first)}`, 0);
  }

  const rows: CommBankCsvRow[] = [];

  for (const [sourceOrdinal, record] of records.entries()) {
    if (record.length !== columns) {
      return yield* reject(
        "column_count",
        `expected ${columns} cells, found ${record.length}`,
        sourceOrdinal,
      );
    }

    const [date, amount, narrative, balance] = record as [string, string, string, string];
    const parts = australianDate.exec(date);

    if (parts === null) {
      return yield* reject(
        "invalid_date",
        `${JSON.stringify(date)} is not DD/MM/YYYY`,
        sourceOrdinal,
      );
    }

    const posted = sourceDate(Number(parts[3]), Number(parts[2]), Number(parts[1]));

    if (Option.isNone(posted)) {
      return yield* reject("invalid_date", `${date} is not a calendar date`, sourceOrdinal);
    }

    const signed = sourceAmount(amount);

    if (Option.isNone(signed)) {
      return yield* reject(
        "invalid_amount",
        `${JSON.stringify(amount)} is not a signed decimal`,
        sourceOrdinal,
      );
    }

    if (profile.rowBalance === "forbidden" && balance !== "") {
      return yield* reject(
        "unexpected_balance",
        `${profile.label} rows carry no running balance, found ${JSON.stringify(balance)}`,
        sourceOrdinal,
      );
    }

    if (profile.rowBalance === "required" && balance === "") {
      return yield* reject(
        "missing_balance",
        `${profile.label} rows carry a running balance`,
        sourceOrdinal,
      );
    }

    const rowBalance = balance === "" ? Option.none<Money>() : sourceAmount(balance);

    if (balance !== "" && Option.isNone(rowBalance)) {
      return yield* reject(
        "invalid_balance",
        `${JSON.stringify(balance)} is not a signed decimal`,
        sourceOrdinal,
      );
    }

    rows.push({
      sourceOrdinal,
      raw: { date, amount, narrative, balance },
      postedDate: posted.value,
      amount: signed.value,
      rowBalance,
    });
  }

  return { profile: profile.id, rows };
});

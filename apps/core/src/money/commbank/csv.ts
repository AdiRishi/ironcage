import type { Money } from "@ironcage/domain";
import { parse } from "csv-parse/sync";
import { Effect, Option, Schema } from "effect";

import { type SourceDate, sourceAmount, sourceDate } from "../values";
import { commBankAccountProfiles, type CommBankAccountProfileId } from "./profiles";

export interface CommBankCsvRow {
  readonly sourceOrdinal: number;
  readonly raw: {
    readonly date: string;
    readonly amount: string;
    readonly narrative: string;
    readonly balance: string;
  };
  readonly postedDate: SourceDate;
  readonly amount: Money;
  readonly rowBalance: Option.Option<Money>;
}

/** A row from a profile whose every row records a running balance. */
export interface BalancedCommBankCsvRow extends CommBankCsvRow {
  readonly rowBalance: Option.Some<Money>;
}

export interface CommBankCsvFile {
  readonly accountProfile: CommBankAccountProfileId;
  readonly rows: readonly CommBankCsvRow[];
  /**
   * The same rows, present exactly when the profile records a balance on every
   * one of them. Reconciliation reads this instead of re-deriving the profile's
   * policy and unwrapping each row on trust.
   */
  readonly balanceChain: Option.Option<readonly BalancedCommBankCsvRow[]>;
}

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
      "source_order",
    ]),
    sourceOrdinal: Schema.NullOr(Schema.Int),
    detail: Schema.String,
  },
) {}

const reject = (
  reason: CommBankCsvRejected["reason"],
  detail: string,
  sourceOrdinal: number | null = null,
) => new CommBankCsvRejected({ reason, sourceOrdinal, detail });

const CsvRecords = Schema.Array(Schema.Array(Schema.String));
const decodeRecords = Schema.decodeUnknownOption(CsvRecords);
const australianDate = /^(\d{2})\/(\d{2})\/(\d{4})$/;

export const decodeCommBankCsv = Effect.fn("decodeCommBankCsv")(function* (
  bytes: Uint8Array,
  accountProfileId: CommBankAccountProfileId,
): Effect.fn.Return<CommBankCsvFile, CommBankCsvRejected> {
  const profile = commBankAccountProfiles[accountProfileId];
  const text = new TextDecoder("windows-1252").decode(bytes);

  for (let index = 0; index < text.length; index++) {
    if (text[index] === "\r" && text[index + 1] !== "\n") {
      return yield* reject("line_endings", `a carriage return at offset ${index} has no line feed`);
    }

    if (text[index] !== "\n") continue;

    if (text[index - 1] !== "\r") {
      return yield* reject("line_endings", `a line feed at offset ${index} has no carriage return`);
    }
  }

  const parsed: unknown = yield* Effect.try({
    try: () =>
      parse(text, {
        bom: false,
        columns: false,
        delimiter: ",",
        escape: '"',
        quote: '"',
        recordDelimiter: "\r\n",
        relaxColumnCount: true,
        relaxQuotes: false,
        skipEmptyLines: false,
        trim: false,
      }),
    catch: (cause) => reject("malformed_csv", String(cause)),
  });
  const decoded = decodeRecords(parsed);

  if (Option.isNone(decoded)) {
    return yield* reject("malformed_csv", "the CSV parser returned non-text cells");
  }

  const first = decoded.value[0]?.[0];

  if (first !== undefined && /^[A-Za-z]/.test(first)) {
    return yield* reject("header_row", `the first row begins with ${JSON.stringify(first)}`, 0);
  }

  const rows: CommBankCsvRow[] = [];
  const balanced: BalancedCommBankCsvRow[] = [];

  for (const [sourceOrdinal, record] of decoded.value.entries()) {
    if (record.length !== 4) {
      return yield* reject(
        "column_count",
        `expected 4 cells, found ${record.length}`,
        sourceOrdinal,
      );
    }

    const date = record[0]!;
    const amount = record[1]!;
    const narrative = record[2]!;
    const balance = record[3]!;
    const parts = australianDate.exec(date);

    if (parts === null) {
      return yield* reject(
        "invalid_date",
        `${JSON.stringify(date)} is not DD/MM/YYYY`,
        sourceOrdinal,
      );
    }

    const postedDate = sourceDate(Number(parts[3]), Number(parts[2]), Number(parts[1]));

    if (Option.isNone(postedDate)) {
      return yield* reject("invalid_date", `${date} is not a calendar date`, sourceOrdinal);
    }

    const previous = rows.at(-1);

    if (previous !== undefined && previous.postedDate < postedDate.value) {
      return yield* reject(
        "source_order",
        `${date} is newer than the preceding row ${previous.raw.date}`,
        sourceOrdinal,
      );
    }

    const signedAmount = sourceAmount(amount);

    if (Option.isNone(signedAmount)) {
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

    if (Option.isNone(rowBalance) && balance !== "") {
      return yield* reject(
        "invalid_balance",
        `${JSON.stringify(balance)} is not a signed decimal`,
        sourceOrdinal,
      );
    }

    const row: CommBankCsvRow = {
      sourceOrdinal,
      raw: { date, amount, narrative, balance },
      postedDate: postedDate.value,
      amount: signedAmount.value,
      rowBalance,
    };

    rows.push(row);
    if (Option.isSome(rowBalance)) balanced.push({ ...row, rowBalance });
  }

  return {
    accountProfile: accountProfileId,
    rows,
    balanceChain:
      profile.rowBalance === "required"
        ? Option.some<readonly BalancedCommBankCsvRow[]>(balanced)
        : Option.none(),
  };
});

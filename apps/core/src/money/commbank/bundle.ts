import type { Money } from "@ironcage/domain";
import { BigDecimal, Effect, Option, Schema } from "effect";

import type { SourceDate } from "../values";
import { type CommBankCsvRejected, type CommBankCsvRow, decodeCommBankCsv } from "./csv";
import {
  type CommBankOfxAccount,
  type CommBankOfxBalance,
  type CommBankOfxRejected,
  type CommBankOfxTransaction,
  decodeCommBankOfx,
} from "./ofx";
import { commBankAccountProfiles, type CommBankProfileId } from "./profiles";

export interface CommBankPairedRow {
  readonly occurrence: number;
  readonly postedDate: SourceDate;
  readonly amount: Money;
  readonly narrative: string;
  readonly csv: CommBankCsvRow;
  readonly ofx: CommBankOfxTransaction;
}

export type CommBankLedgerReconciliation =
  | {
      readonly status: "matched";
      readonly ledgerBalance: CommBankOfxBalance;
      readonly newestRowBalance: Money;
    }
  | {
      readonly status: "outside_covered_window";
      readonly ledgerBalance: CommBankOfxBalance;
      readonly newestRowBalance: Money;
    }
  | {
      readonly status: "unavailable";
      readonly ledgerBalance: CommBankOfxBalance;
    };

export interface CommBankPairedBundle {
  readonly profile: CommBankProfileId;
  readonly account: CommBankOfxAccount;
  readonly window: { readonly start: SourceDate; readonly end: SourceDate };
  readonly rows: readonly CommBankPairedRow[];
  readonly ledger: CommBankLedgerReconciliation;
  readonly availableBalance: Option.Option<CommBankOfxBalance>;
}

export class CommBankBundleBlocked extends Schema.TaggedError<CommBankBundleBlocked>()(
  "CommBankBundleBlocked",
  {
    reason: Schema.Literals([
      "row_count_mismatch",
      "export_truncated",
      "unpaired_row",
      "balance_chain",
      "ledger_disagreement",
    ]),
    sourceOrdinal: Schema.NullOr(Schema.Int),
    detail: Schema.String,
  },
) {}

const block = (
  reason: CommBankBundleBlocked["reason"],
  detail: string,
  sourceOrdinal: number | null = null,
) => new CommBankBundleBlocked({ reason, sourceOrdinal, detail });

const exportRowCeiling = 600;

const pairingKey = (postedDate: SourceDate, amount: Money, narrative: string) =>
  JSON.stringify([postedDate, BigDecimal.format(BigDecimal.normalize(amount)), narrative]);

export const decodeCommBankBundle = Effect.fn("decodeCommBankBundle")(function* (
  csvBytes: Uint8Array,
  ofxBytes: Uint8Array,
  profileId: CommBankProfileId,
): Effect.fn.Return<
  CommBankPairedBundle,
  CommBankBundleBlocked | CommBankCsvRejected | CommBankOfxRejected
> {
  const profile = commBankAccountProfiles[profileId];
  const csv = yield* decodeCommBankCsv(csvBytes, profileId);
  const ofx = yield* decodeCommBankOfx(ofxBytes, profileId);

  if (csv.rows.length !== ofx.transactions.length) {
    return yield* block(
      "row_count_mismatch",
      `the CSV holds ${csv.rows.length} rows and the OFX holds ${ofx.transactions.length}`,
    );
  }

  // NetBank silently caps broad searches at 600 rows, so that count cannot prove coverage.
  if (csv.rows.length === exportRowCeiling) {
    return yield* block(
      "export_truncated",
      `a ${exportRowCeiling}-row export is at NetBank's search ceiling and cannot prove its window is complete`,
    );
  }

  const unclaimed = new Map<string, CommBankOfxTransaction[]>();

  for (const transaction of ofx.transactions) {
    const key = pairingKey(transaction.postedDate, transaction.amount, transaction.narrative);
    const group = unclaimed.get(key);

    if (group === undefined) unclaimed.set(key, [transaction]);
    else group.push(transaction);
  }

  const occurrences = new Map<string, number>();
  const rows: CommBankPairedRow[] = [];

  for (const row of csv.rows) {
    const key = pairingKey(row.postedDate, row.amount, row.raw.narrative);
    const partner = unclaimed.get(key)?.shift();

    if (partner === undefined) {
      return yield* block(
        "unpaired_row",
        `no unpaired OFX transaction matches ${row.raw.date} ${row.raw.amount} ${JSON.stringify(row.raw.narrative)}`,
        row.sourceOrdinal,
      );
    }

    const occurrence = (occurrences.get(key) ?? 0) + 1;

    occurrences.set(key, occurrence);
    rows.push({
      occurrence,
      postedDate: row.postedDate,
      amount: row.amount,
      narrative: row.raw.narrative,
      csv: row,
      ofx: partner,
    });
  }

  if (profile.rowBalance === "required") {
    let earlierBalance: Money | undefined;

    for (const row of [...csv.rows].reverse()) {
      const rowBalance = Option.getOrThrow(row.rowBalance);

      if (earlierBalance !== undefined) {
        const expected = BigDecimal.sum(earlierBalance, row.amount);

        if (!BigDecimal.equals(expected, rowBalance)) {
          return yield* block(
            "balance_chain",
            `${row.raw.date} ${row.raw.amount} runs ${BigDecimal.format(earlierBalance)} to ${BigDecimal.format(expected)}, but the row records ${row.raw.balance}`,
            row.sourceOrdinal,
          );
        }
      }

      earlierBalance = rowBalance;
    }
  }

  const newest = csv.rows[0];
  let ledger: CommBankLedgerReconciliation;

  if (newest === undefined || profile.rowBalance === "forbidden") {
    ledger = { status: "unavailable", ledgerBalance: ofx.ledgerBalance };
  } else {
    const newestRowBalance = Option.getOrThrow(newest.rowBalance);

    // An export-time ledger balance is comparable only while the newest row proves that moment.
    const comparable =
      newest.postedDate <= ofx.ledgerBalance.asOfDate &&
      ofx.ledgerBalance.asOfDate <= ofx.window.end;

    if (comparable && !BigDecimal.equals(newestRowBalance, ofx.ledgerBalance.amount)) {
      return yield* block(
        "ledger_disagreement",
        `the newest row records ${newest.raw.balance} and LEDGERBAL records ${BigDecimal.format(ofx.ledgerBalance.amount)} as of ${ofx.ledgerBalance.raw}`,
        newest.sourceOrdinal,
      );
    }

    ledger = {
      status: comparable ? "matched" : "outside_covered_window",
      ledgerBalance: ofx.ledgerBalance,
      newestRowBalance,
    };
  }

  return {
    profile: profileId,
    account: ofx.account,
    window: ofx.window,
    rows,
    ledger,
    availableBalance: ofx.availableBalance,
  };
});

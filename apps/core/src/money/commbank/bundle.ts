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
import type { CommBankAccountProfile, CommBankProfileId } from "./profiles";

/**
 * A recent-history import is a CSV and an OFX exported from one account without
 * changing the selected window. Neither file is accepted on its own: the CSV
 * carries a running balance and no account identity, the OFX carries account
 * identity and no running balance, and only the two together can prove that
 * what they describe is the same list of movements.
 *
 * This module is the proof. It decodes both files under one profile, pairs
 * every row one-to-one, and refuses the bundle when anything about the pair
 * disagrees. What it returns is a list of transaction candidates, each carrying
 * both of its source observations — not yet canonical transactions, which is
 * deduplication's decision and needs the stored record this module never reads.
 *
 * Two of the blocking conditions in the specification are not here, because
 * both compare the bundle against something outside it: OFX account identity
 * against the account the operator selected, and the source window against the
 * window the upload declared. Both belong to the import layer above, which
 * holds the selection and the stored accounts.
 */
export interface CommBankPairedRow {
  /**
   * The transaction's one-based position among rows sharing its posted date,
   * amount, and narrative, counted in source order. Almost always 1 — the
   * observed 218-row sample repeated no `(date, amount)` pair at all — and the
   * reason deduplication can claim a stored occurrence exactly once when it
   * finally is not.
   */
  readonly occurrence: number;
  /**
   * The three fields pairing proved both files agree on. Everything either file
   * says alone — the CSV's running balance, the OFX's `FITID` and `TRNTYPE` —
   * stays on the observation that said it, so a later reader can see which
   * source an inherited fact came from.
   */
  readonly postedDate: SourceDate;
  readonly amount: Money;
  readonly narrative: string;
  readonly csv: CommBankCsvRow;
  readonly ofx: CommBankOfxTransaction;
}

/**
 * What the newest CSV row balance proved about the file-level ledger balance.
 *
 * The two agree only under a condition the bank's own export decides, so the
 * result is recorded rather than assumed. See {@link decodeCommBankBundle} for
 * why `matched` is not always available.
 */
export interface CommBankLedgerReconciliation {
  readonly status: "matched" | "outside_covered_window" | "unavailable";
  readonly ledgerBalance: CommBankOfxBalance;
  /** Absent on a profile with no per-row balance, and on an empty export. */
  readonly newestRowBalance: Option.Option<Money>;
}

export interface CommBankPairedBundle {
  readonly profile: CommBankProfileId;
  /** From the OFX, which is the only file in the bundle that names an account. */
  readonly account: CommBankOfxAccount;
  /** `DTSTART` and `DTEND`, which the profile reads as the requested coverage window. */
  readonly window: { readonly start: SourceDate; readonly end: SourceDate };
  /** In source order, which every observed export writes newest first. */
  readonly rows: readonly CommBankPairedRow[];
  readonly ledger: CommBankLedgerReconciliation;
  /** Retained beside the ledger balance and never substituted for it. */
  readonly availableBalance: Option.Option<CommBankOfxBalance>;
}

/**
 * A refusal to treat the two files as one bundle. It is not a parse failure —
 * both files were readable — so it carries its own tag rather than joining the
 * decoders' rejections.
 */
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
    /** The CSV row that was refused, or `null` when the whole bundle was. */
    sourceOrdinal: Schema.NullOr(Schema.Int),
    detail: Schema.String,
  },
) {}

const block = (
  reason: CommBankBundleBlocked["reason"],
  detail: string,
  sourceOrdinal: number | null = null,
) => new CommBankBundleBlocked({ reason, sourceOrdinal, detail });

/**
 * NetBank returned exactly this many rows for a broad search and silently
 * omitted older ones. A file at the ceiling cannot prove whether its window
 * held exactly 600 transactions or more than the search would return, so it
 * cannot claim coverage. The operator re-exports a smaller window.
 */
const exportRowCeiling = 600;

/**
 * The pairing key: posted date, signed amount, and raw narrative.
 *
 * The amount is normalized first because the two files write the same number
 * differently — `"+2500.00"` in the CSV and `2500.00` in the OFX — and pairing
 * compares values, not spellings. Fields are joined on a byte no bank narrative
 * contains, so a narrative can never spell out a key that belongs to another
 * row.
 */
const pairingKey = (postedDate: SourceDate, amount: Money, narrative: string) => {
  const normalized = BigDecimal.normalize(amount);

  return `${postedDate}\u0000${normalized.value}e${normalized.scale}\u0000${narrative}`;
};

export const decodeCommBankBundle = Effect.fn("decodeCommBankBundle")(function* (
  csvBytes: Uint8Array,
  ofxBytes: Uint8Array,
  profile: CommBankAccountProfile,
): Effect.fn.Return<
  CommBankPairedBundle,
  CommBankBundleBlocked | CommBankCsvRejected | CommBankOfxRejected
> {
  const csv = yield* decodeCommBankCsv(csvBytes, profile);
  const ofx = yield* decodeCommBankOfx(ofxBytes, profile);

  if (csv.rows.length !== ofx.transactions.length) {
    return yield* block(
      "row_count_mismatch",
      `the CSV holds ${csv.rows.length} rows and the OFX holds ${ofx.transactions.length}`,
    );
  }

  // Pairing is one-to-one, so it cannot change the count it validates. Equal
  // counts therefore settle the logical transaction count before any row is
  // paired, and a truncated export is refused without pretending to read it.
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

  // Each OFX row is consumed once, so two identical CSV rows need two identical
  // OFX rows to pair. An extra OFX row needs no check of its own: the counts
  // already agree, so it can only exist beside a CSV row that found no partner.
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

  // The export is newest first and the chain runs the other way, so the file is
  // read in reverse. Every adjacent pair that carries balances is checked; the
  // profile is what makes that all of them or none, since it already refused a
  // file whose balance column disagreed with the account type.
  let earlier: CommBankCsvRow | undefined;

  for (const row of [...csv.rows].reverse()) {
    if (
      earlier !== undefined &&
      Option.isSome(earlier.rowBalance) &&
      Option.isSome(row.rowBalance)
    ) {
      const expected = BigDecimal.sum(earlier.rowBalance.value, row.amount);

      // Exact decimal equality. A near-match is a different transaction list.
      if (!BigDecimal.equals(expected, row.rowBalance.value)) {
        return yield* block(
          "balance_chain",
          `${row.raw.date} ${row.raw.amount} runs ${BigDecimal.format(earlier.rowBalance.value)} to ${BigDecimal.format(expected)}, but the row records ${row.raw.balance}`,
          row.sourceOrdinal,
        );
      }
    }

    earlier = row;
  }

  const ledgerBalance = ofx.ledgerBalance;
  const newest = csv.rows[0];
  const newestRowBalance = newest?.rowBalance ?? Option.none<Money>();

  // The ledger balance is a moment rather than a window total: every observed
  // export stamped `DTASOF` with the time the file was produced, not the end of
  // the requested window. It can only be checked against the newest row when
  // that moment lies inside what the rows themselves prove — at or after the
  // newest posted row, and no later than the window the file claims to cover.
  // A window that closed before the export was taken leaves the account free to
  // have moved since, and the newest row is not evidence about that balance.
  // The dates are ISO-8601, so they order as strings.
  const provable =
    newest !== undefined &&
    newest.postedDate <= ledgerBalance.asOfDate &&
    ledgerBalance.asOfDate <= ofx.window.end;

  if (provable && Option.isSome(newestRowBalance)) {
    if (!BigDecimal.equals(newestRowBalance.value, ledgerBalance.amount)) {
      return yield* block(
        "ledger_disagreement",
        `the newest row records ${newest.raw.balance} and LEDGERBAL records ${BigDecimal.format(ledgerBalance.amount)} as of ${ledgerBalance.raw}`,
        newest.sourceOrdinal,
      );
    }
  }

  return {
    profile: profile.id,
    account: ofx.account,
    window: ofx.window,
    rows,
    ledger: {
      status: Option.isNone(newestRowBalance)
        ? "unavailable"
        : provable
          ? "matched"
          : "outside_covered_window",
      ledgerBalance,
      newestRowBalance,
    },
    availableBalance: ofx.availableBalance,
  };
});

import type { BankAccountType, CalendarDate } from "@ironcage/domain";
import { BigDecimal, Effect } from "effect";

import { BankImportBlocked, blocked } from "./block";
import { sha256Hex } from "./bytes";
import type { CsvRow } from "./csv";
import type { OfxBalance, OfxStatement, OfxTransaction } from "./ofx";
import { pairedRules, truncationRowCount } from "./profiles";

/**
 * One incoming logical transaction: a CSV row and its proven OFX counterpart.
 * `occurrence` is the 1-based position in source order among rows equal on
 * (posted date, signed amount, raw narrative) — the claim-once key tier 3 uses.
 */
export interface PairedCandidate {
  readonly csv: CsvRow;
  readonly ofx: OfxTransaction;
  readonly occurrence: number;
}

export interface PairedBundle {
  readonly accountType: BankAccountType;
  readonly window: { readonly start: CalendarDate; readonly end: CalendarDate };
  readonly candidates: readonly PairedCandidate[];
  readonly ledger: OfxBalance | null;
  readonly available: OfxBalance | null;
  /** Whether the newest row balance was reconciled against the OFX ledger. */
  readonly ledgerReconciled: boolean;
}

const pairingKey = (date: CalendarDate, amount: BigDecimal.BigDecimal, narrative: string) =>
  `${date}|${BigDecimal.format(BigDecimal.normalize(amount))}|${narrative}`;

const newestFirst = (dates: readonly CalendarDate[]): boolean =>
  dates.every((date, index) => index === 0 || date <= dates[index - 1]!);

const money = (value: BigDecimal.BigDecimal) => BigDecimal.format(BigDecimal.normalize(value));

/**
 * Validates a parsed CSV/OFX pair as one bundle under the selected account's
 * profile rules and produces the incoming candidates. Nothing downstream runs
 * unless every check here passes; one missing, extra, or conflicting row
 * blocks the whole bundle.
 */
export const validatePairedBundle = Effect.fn("validatePairedBundle")(function* (
  accountType: BankAccountType,
  csvRows: readonly CsvRow[],
  ofx: OfxStatement,
): Effect.fn.Return<PairedBundle, BankImportBlocked> {
  const rules = pairedRules[accountType];

  if (rules.acctType !== null && ofx.account.acctType !== rules.acctType) {
    return yield* blocked(
      "OfxGrammar",
      `ACCTTYPE is ${ofx.account.acctType ?? "absent"}, the ${accountType} profile expects ${rules.acctType}`,
    );
  }

  for (const transaction of ofx.transactions) {
    if (rules.fitids === "verified" && transaction.fitid === "") {
      return yield* blocked(
        "OfxGrammar",
        `row ${transaction.ordinal + 1} has an empty FITID; the profile proved one on every row`,
      );
    }
    if (rules.fitids === "empty" && transaction.fitid !== "") {
      return yield* blocked(
        "OfxGrammar",
        `row ${transaction.ordinal + 1} has a populated FITID; the profile proved them empty`,
      );
    }
  }

  if (csvRows.length !== ofx.transactions.length) {
    return yield* blocked(
      "PairingMismatch",
      `the CSV has ${csvRows.length} rows and the OFX has ${ofx.transactions.length}`,
    );
  }

  if (csvRows.length >= truncationRowCount) {
    return yield* blocked(
      "ExportTruncated",
      `${csvRows.length} rows meets the ${truncationRowCount}-row cap; re-export a smaller window`,
    );
  }

  if (!newestFirst(csvRows.map((row) => row.postedDate))) {
    return yield* blocked("RowOrder", "CSV rows are not newest first");
  }
  if (!newestFirst(ofx.transactions.map((transaction) => transaction.posted))) {
    return yield* blocked("RowOrder", "OFX rows are not newest first");
  }

  // Exact multiset pairing on (posted date, signed amount, raw narrative):
  // group both sides by the composite key and pair positionally in source
  // order, consuming each row once.
  const ofxByKey = new Map<string, OfxTransaction[]>();
  for (const transaction of ofx.transactions) {
    const key = pairingKey(transaction.posted, transaction.amount, transaction.memo);
    const group = ofxByKey.get(key);
    if (group === undefined) ofxByKey.set(key, [transaction]);
    else group.push(transaction);
  }

  const occurrenceByKey = new Map<string, number>();
  const candidates: PairedCandidate[] = [];

  for (const row of csvRows) {
    const key = pairingKey(row.postedDate, row.amount, row.raw.narrative);
    const group = ofxByKey.get(key);
    const partner = group?.shift();
    if (partner === undefined) {
      return yield* blocked(
        "PairingMismatch",
        `CSV row ${row.ordinal + 1} (${row.raw.date} ${row.raw.amount} "${row.raw.narrative}") has no unconsumed OFX counterpart`,
      );
    }
    const occurrence = (occurrenceByKey.get(key) ?? 0) + 1;
    occurrenceByKey.set(key, occurrence);
    candidates.push({ csv: row, ofx: partner, occurrence });
  }

  // Row counts already matched, so every OFX group is now empty; the window
  // is the OFX file's own claim, proven to describe the CSV by the pairing.
  if (ofx.window.start > ofx.window.end) {
    return yield* blocked("OfxGrammar", "DTSTART is after DTEND");
  }

  yield* validateBalanceChain(csvRows);

  const ledgerReconciled = yield* reconcileLedger(csvRows, ofx);

  return {
    accountType,
    window: ofx.window,
    candidates,
    ledger: ofx.ledger,
    available: ofx.available,
    ledgerReconciled,
  };
});

/**
 * Replays the CSV in chronological order and requires every populated balance
 * to equal its predecessor plus the row amount, exactly. The oldest row has no
 * predecessor inside the file, so the chain starts at its recorded balance.
 */
const validateBalanceChain = Effect.fn("validateBalanceChain")(function* (
  csvRows: readonly CsvRow[],
) {
  const chronological = [...csvRows].reverse();

  for (let index = 1; index < chronological.length; index += 1) {
    const previous = chronological[index - 1]!;
    const row = chronological[index]!;
    if (previous.balance === null || row.balance === null) continue;

    const expected = BigDecimal.sum(previous.balance, row.amount);
    if (!BigDecimal.equals(expected, row.balance)) {
      return yield* blocked(
        "BalanceChainFailed",
        `row ${row.ordinal + 1}: ${money(previous.balance)} + ${money(row.amount)} = ${money(expected)}, the file records ${money(row.balance)}`,
      );
    }
  }
});

/**
 * The OFX ledger balance is a moment, not a window total: it reconciles
 * against the newest row balance only when its as-of date falls between the
 * newest posted row and `DTEND`. Outside that span it remains a balance
 * observation without a reconciliation claim.
 */
const reconcileLedger = Effect.fn("reconcileLedger")(function* (
  csvRows: readonly CsvRow[],
  ofx: OfxStatement,
): Effect.fn.Return<boolean, BankImportBlocked> {
  const newest = csvRows[0];
  if (newest?.balance == null || ofx.ledger === null) return false;

  const inScope = ofx.ledger.asOfDate >= newest.postedDate && ofx.ledger.asOfDate <= ofx.window.end;
  if (!inScope) return false;

  if (!BigDecimal.equals(newest.balance, ofx.ledger.amount)) {
    return yield* blocked(
      "LedgerMismatch",
      `newest row balance ${money(newest.balance)} disagrees with the OFX ledger balance ${money(ofx.ledger.amount)}`,
    );
  }
  return true;
});

/**
 * Tier 0's identity: the profile, the selected account, and each file's role
 * and byte digest, order-independent.
 */
export const bundleDigest = (
  profile: string,
  accountId: string,
  files: ReadonlyArray<{ readonly role: string; readonly digest: string }>,
): Promise<string> => {
  const parts = files.map((file) => `${file.role}:${file.digest}`).sort();
  return sha256Hex(new TextEncoder().encode(`${profile}|${accountId}|${parts.join("|")}`));
};

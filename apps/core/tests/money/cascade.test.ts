import { BankTransactionId, uuidV7From } from "@ironcage/domain";
import { BigDecimal, Effect, Schema } from "effect";
import { describe, expect, test } from "vitest";

import type { BankImportBlocked } from "../../src/money/block";
import { validatePairedBundle, type PairedBundle } from "../../src/money/bundle";
import {
  matchCandidates,
  type StoredEvidence,
  type StoredIdentifier,
  type StoredTransaction,
} from "../../src/money/cascade";
import { parseBankCsv } from "../../src/money/csv";
import { narrativeFingerprint } from "../../src/money/normalize";
import { parseBankOfx } from "../../src/money/ofx";
import { pairedRules } from "../../src/money/profiles";
import homeLoanCsv from "../fixtures/money/commbank/home-loan/home-loan-a.csv?bytes";
import homeLoanOfx from "../fixtures/money/commbank/home-loan/home-loan-a.ofx?bytes";
import mastercardCsv from "../fixtures/money/commbank/mastercard/mastercard-a.csv?bytes";
import mastercardOfx from "../fixtures/money/commbank/mastercard/mastercard-a.ofx?bytes";
import spendingACsv from "../fixtures/money/commbank/spending-offset/spending-offset-a.csv?bytes";
import spendingAOfx from "../fixtures/money/commbank/spending-offset/spending-offset-a.ofx?bytes";
import spendingBCsv from "../fixtures/money/commbank/spending-offset/spending-offset-b.csv?bytes";
import spendingBOfx from "../fixtures/money/commbank/spending-offset/spending-offset-b.ofx?bytes";
import spendingCCsv from "../fixtures/money/commbank/spending-offset/spending-offset-c.csv?bytes";
import spendingCOfx from "../fixtures/money/commbank/spending-offset/spending-offset-c.ofx?bytes";

const transactionId = Schema.decodeUnknownSync(BankTransactionId);

let minted = 0;
const mintId = () => {
  minted += 1;
  const random = new Uint8Array(16);
  random[15] = minted % 256;
  random[14] = Math.floor(minted / 256);
  return transactionId(uuidV7From(minted, random));
};

const bundle = (
  csv: Uint8Array,
  ofx: Uint8Array,
  account: keyof typeof pairedRules,
): PairedBundle => {
  const rules = pairedRules[account];
  return Effect.runSync(
    validatePairedBundle(
      account,
      Effect.runSync(parseBankCsv(csv, rules.csvBalances)),
      Effect.runSync(parseBankOfx(ofx, rules.ofxVariant)),
    ),
  );
};

/** Simulates a confirmed import: every candidate becomes a stored transaction. */
const store = (imported: PairedBundle, verifiedFitids: boolean): StoredEvidence => {
  const transactions: StoredTransaction[] = [];
  const identifiers = new Map<string, StoredIdentifier>();

  // Stored source order matches creation order, oldest import first.
  for (const candidate of imported.candidates) {
    const stored: StoredTransaction = {
      id: mintId(),
      postedDate: candidate.csv.postedDate,
      amount: candidate.csv.amount,
      fingerprint: narrativeFingerprint(candidate.csv.raw.narrative),
      rowBalance: candidate.csv.balance,
    };
    transactions.push(stored);
    if (verifiedFitids) {
      identifiers.set(candidate.ofx.fitid, {
        transactionId: stored.id,
        postedDate: stored.postedDate,
        amount: stored.amount,
        fingerprint: stored.fingerprint,
      });
    }
  }

  return { transactions, identifiers };
};

const empty: StoredEvidence = { transactions: [], identifiers: new Map() };

const block = (effect: Effect.Effect<unknown, BankImportBlocked>): BankImportBlocked =>
  Effect.runSync(Effect.flip(effect));

describe("the dedupe cascade", () => {
  test("a first import is new throughout", () => {
    const spending = bundle(spendingACsv, spendingAOfx, "deposit");
    const outcomes = Effect.runSync(
      matchCandidates(spending.candidates, pairedRules.deposit, empty),
    );

    expect(outcomes.every((outcome) => outcome.result.kind === "new")).toBe(true);
  });

  test("a reimport links every row through the verified identifier", () => {
    const spending = bundle(spendingACsv, spendingAOfx, "deposit");
    const stored = store(spending, true);
    const outcomes = Effect.runSync(
      matchCandidates(spending.candidates, pairedRules.deposit, stored),
    );

    expect(
      outcomes.every(
        (outcome) => outcome.result.kind === "duplicate" && outcome.result.tier === "identifier",
      ),
    ).toBe(true);
  });

  test("an overlapping window adds only the later rows", () => {
    const first = bundle(spendingACsv, spendingAOfx, "deposit");
    const second = bundle(spendingBCsv, spendingBOfx, "deposit");
    const stored = store(first, true);

    const outcomes = Effect.runSync(
      matchCandidates(second.candidates, pairedRules.deposit, stored),
    );
    const duplicates = outcomes.filter((outcome) => outcome.result.kind === "duplicate");
    const fresh = outcomes.filter((outcome) => outcome.result.kind === "new");

    // The manifest records 25 shared transactions between windows a and b.
    expect(duplicates).toHaveLength(25);
    expect(fresh).toHaveLength(0);
  });

  test("three overlapping windows never double-count", () => {
    const first = bundle(spendingACsv, spendingAOfx, "deposit");
    const stored = store(first, true);

    const second = Effect.runSync(
      matchCandidates(bundle(spendingBCsv, spendingBOfx, "deposit").candidates, pairedRules.deposit, stored),
    );
    const third = Effect.runSync(
      matchCandidates(bundle(spendingCCsv, spendingCOfx, "deposit").candidates, pairedRules.deposit, stored),
    );

    expect(second.filter((outcome) => outcome.result.kind === "duplicate")).toHaveLength(25);
    expect(third.filter((outcome) => outcome.result.kind === "duplicate")).toHaveLength(23);
  });

  test("a stored identifier with a different amount blocks the import", () => {
    const spending = bundle(spendingACsv, spendingAOfx, "deposit");
    const stored = store(spending, true);
    const shifted = {
      ...stored,
      identifiers: new Map(
        [...stored.identifiers].map(([fitid, identifier], index) =>
          index === 0
            ? [fitid, { ...identifier, amount: BigDecimal.fromStringUnsafe("999.99") }]
            : [fitid, identifier],
        ),
      ),
    };

    expect(block(matchCandidates(spending.candidates, pairedRules.deposit, shifted)).code).toBe(
      "SourceIdentifierConflict",
    );
  });

  test("a narrative variant links with a warning instead of a new row", () => {
    const spending = bundle(spendingACsv, spendingAOfx, "deposit");
    const stored = store(spending, true);
    const variant = {
      ...stored,
      identifiers: new Map(
        [...stored.identifiers].map(([fitid, identifier]) => [
          fitid,
          { ...identifier, fingerprint: `${identifier.fingerprint} rendered differently` },
        ]),
      ),
    };

    const outcomes = Effect.runSync(
      matchCandidates(spending.candidates, pairedRules.deposit, variant),
    );
    expect(
      outcomes.every(
        (outcome) => outcome.result.kind === "duplicate" && outcome.result.narrativeVariant,
      ),
    ).toBe(true);
  });

  test("the home loan reimport links on row balance without identifiers", () => {
    const homeLoan = bundle(homeLoanCsv, homeLoanOfx, "credit_line");
    const stored = store(homeLoan, false);

    const outcomes = Effect.runSync(
      matchCandidates(homeLoan.candidates, pairedRules.credit_line, stored),
    );
    expect(
      outcomes.every(
        (outcome) => outcome.result.kind === "duplicate" && outcome.result.tier === "row_balance",
      ),
    ).toBe(true);
  });

  test("the mastercard reimport links on content occurrence", () => {
    const mastercard = bundle(mastercardCsv, mastercardOfx, "credit_card");
    const stored = store(mastercard, false);

    const outcomes = Effect.runSync(
      matchCandidates(mastercard.candidates, pairedRules.credit_card, stored),
    );
    expect(
      outcomes.every(
        (outcome) => outcome.result.kind === "duplicate" && outcome.result.tier === "content",
      ),
    ).toBe(true);
  });

  test("a different balance position is negative evidence, not a duplicate", () => {
    const homeLoan = bundle(homeLoanCsv, homeLoanOfx, "credit_line");
    const stored = store(homeLoan, false);
    const shifted = {
      ...stored,
      transactions: stored.transactions.map((transaction) => ({
        ...transaction,
        rowBalance:
          transaction.rowBalance === null
            ? null
            : BigDecimal.sum(transaction.rowBalance, BigDecimal.fromStringUnsafe("0.01")),
      })),
    };

    const outcomes = Effect.runSync(
      matchCandidates(homeLoan.candidates, pairedRules.credit_line, shifted),
    );
    // Same dates, amounts, and narratives — but every stored balance position
    // differs, so tier 2 excludes them and tier 3 may not resurrect the link.
    expect(outcomes.every((outcome) => outcome.result.kind === "new")).toBe(true);
  });

  test("an occurrence-count mismatch turns the whole group ambiguous", () => {
    const mastercard = bundle(mastercardCsv, mastercardOfx, "credit_card");
    const stored = store(mastercard, false);
    // The incoming export shows the same purchase twice; the record has one.
    const duplicated = [
      mastercard.candidates[0]!,
      { ...mastercard.candidates[0]!, occurrence: 2 },
      ...mastercard.candidates.slice(1),
    ];

    const outcomes = Effect.runSync(
      matchCandidates(duplicated, pairedRules.credit_card, stored),
    );
    const ambiguous = outcomes.filter((outcome) => outcome.result.kind === "ambiguous");
    expect(ambiguous).toHaveLength(2);
  });

  test("claim-once: one stored row cannot satisfy two incoming candidates", () => {
    const mastercard = bundle(mastercardCsv, mastercardOfx, "credit_card");
    const stored = store(mastercard, false);
    const outcomes = Effect.runSync(
      matchCandidates(mastercard.candidates, pairedRules.credit_card, stored),
    );

    const linked = outcomes.flatMap((outcome) =>
      outcome.result.kind === "duplicate" ? [outcome.result.transactionId] : [],
    );
    expect(new Set(linked).size).toBe(linked.length);
  });
});

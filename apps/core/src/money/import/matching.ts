import type { BankTransactionId, CalendarDate, MatchTier } from "@ironcage/domain";
import { BigDecimal, Effect } from "effect";

import { BankImportBlocked, blocked } from "./block";
import type { PairedCandidate } from "./bundle";
import { narrativeFingerprint } from "./normalize";
import type { PairedAccountRules } from "./profiles";

/**
 * The stored evidence the matching cascade compares against: every canonical
 * transaction for the account on the candidate dates, plus the verified
 * identifier index for tier 1. Loaded once per import from a consistent
 * snapshot; the cascade itself is pure.
 */
export interface StoredEvidence {
  readonly transactions: readonly StoredTransaction[];
  /** Keyed by FITID; populated only for verified-identifier profiles. */
  readonly identifiers: ReadonlyMap<string, StoredIdentifier>;
}

export interface StoredTransaction {
  readonly id: BankTransactionId;
  readonly postedDate: CalendarDate;
  readonly amount: BigDecimal.BigDecimal;
  readonly fingerprint: string;
  readonly rowBalance: BigDecimal.BigDecimal | null;
}

export interface StoredIdentifier {
  readonly transactionId: BankTransactionId;
  readonly postedDate: CalendarDate;
  readonly amount: BigDecimal.BigDecimal;
  readonly fingerprint: string;
}

export type MatchResult =
  | {
      readonly kind: "duplicate";
      readonly transactionId: BankTransactionId;
      readonly tier: Exclude<MatchTier, "new" | "bundle">;
      /** The linked transaction's narrative renders differently in this source. */
      readonly narrativeVariant: boolean;
    }
  | { readonly kind: "new" }
  | { readonly kind: "ambiguous"; readonly options: readonly BankTransactionId[] };

export interface MatchOutcome {
  readonly candidate: PairedCandidate;
  readonly result: MatchResult;
}

const numeric = (value: BigDecimal.BigDecimal) => BigDecimal.format(BigDecimal.normalize(value));

const contentSignature = (date: CalendarDate, amount: BigDecimal.BigDecimal, fingerprint: string) =>
  `${date}|${numeric(amount)}|${fingerprint}`;

const balanceSignature = (
  date: CalendarDate,
  amount: BigDecimal.BigDecimal,
  balance: BigDecimal.BigDecimal,
) => `${date}|${numeric(amount)}|${numeric(balance)}`;

interface Pending {
  readonly candidate: PairedCandidate;
  readonly fingerprint: string;
  /** Tier 2's negative evidence: stored IDs proven not to be this movement. */
  readonly excluded: ReadonlySet<BankTransactionId>;
}

/**
 * Tiers 1–3 and 5 of the dedupe cascade, in their fixed order. Tier 0 (bundle
 * digest) never reaches this code — an already-confirmed bundle returns its
 * earlier result before matching begins — and tier 4 belongs to the statement
 * pipeline. Each linked stored transaction is claimed at most once per bundle.
 */
export const matchCandidates = Effect.fn("matchCandidates")(function* (
  candidates: readonly PairedCandidate[],
  rules: PairedAccountRules,
  stored: StoredEvidence,
): Effect.fn.Return<readonly MatchOutcome[], BankImportBlocked> {
  const claimed = new Set<BankTransactionId>();
  const outcomes = new Map<PairedCandidate, MatchResult>();
  const pending: Pending[] = [];

  for (const candidate of candidates) {
    const fingerprint = narrativeFingerprint(candidate.csv.raw.narrative);

    // Tier 1: a verified bank identifier is authoritative when its date and
    // amount agree, and a hard conflict when they do not — the identifier is
    // never allowed to overwrite earlier facts.
    if (rules.fitids === "verified") {
      const identifier = stored.identifiers.get(candidate.ofx.fitid);
      if (identifier !== undefined) {
        const agrees =
          identifier.postedDate === candidate.csv.postedDate &&
          BigDecimal.equals(identifier.amount, candidate.csv.amount);
        if (!agrees) {
          return yield* blocked(
            "SourceIdentifierConflict",
            `FITID ${candidate.ofx.fitid} is stored with a different date or amount`,
          );
        }
        claimed.add(identifier.transactionId);
        outcomes.set(candidate, {
          kind: "duplicate",
          transactionId: identifier.transactionId,
          tier: "identifier",
          narrativeVariant: identifier.fingerprint !== fingerprint,
        });
        continue;
      }
    }

    // Tier 2: an exact row-balance position. Zero matches leaves negative
    // evidence — a stored transaction with its own different balance position
    // is proven not to be this movement and is excluded below.
    if (candidate.csv.balance !== null) {
      const signature = balanceSignature(
        candidate.csv.postedDate,
        candidate.csv.amount,
        candidate.csv.balance,
      );
      const matches = stored.transactions.filter(
        (transaction) =>
          transaction.rowBalance !== null &&
          !claimed.has(transaction.id) &&
          balanceSignature(transaction.postedDate, transaction.amount, transaction.rowBalance) ===
            signature,
      );

      if (matches.length === 1) {
        const match = matches[0]!;
        claimed.add(match.id);
        outcomes.set(candidate, {
          kind: "duplicate",
          transactionId: match.id,
          tier: "row_balance",
          narrativeVariant: match.fingerprint !== fingerprint,
        });
        continue;
      }
      if (matches.length > 1) {
        outcomes.set(candidate, {
          kind: "ambiguous",
          options: matches.map((match) => match.id),
        });
        continue;
      }

      const excluded = new Set(
        stored.transactions
          .filter(
            (transaction) =>
              transaction.rowBalance !== null &&
              transaction.postedDate === candidate.csv.postedDate &&
              BigDecimal.equals(transaction.amount, candidate.csv.amount),
          )
          .map((transaction) => transaction.id),
      );
      pending.push({ candidate, fingerprint, excluded });
      continue;
    }

    pending.push({ candidate, fingerprint, excluded: new Set() });
  }

  // Tier 3: exact content and occurrence, resolved group-wise so claim-once
  // holds — two genuine identical purchases can never both link to one row.
  const groups = new Map<string, Pending[]>();
  for (const entry of pending) {
    const signature = contentSignature(
      entry.candidate.csv.postedDate,
      entry.candidate.csv.amount,
      entry.fingerprint,
    );
    const group = groups.get(signature);
    if (group === undefined) groups.set(signature, [entry]);
    else group.push(entry);
  }

  for (const [signature, group] of groups) {
    const excluded = group[0]!.excluded;
    const storedGroup = stored.transactions.filter(
      (transaction) =>
        !claimed.has(transaction.id) &&
        !excluded.has(transaction.id) &&
        contentSignature(transaction.postedDate, transaction.amount, transaction.fingerprint) ===
          signature,
    );

    if (storedGroup.length === 0) {
      for (const entry of group) outcomes.set(entry.candidate, { kind: "new" });
    } else if (storedGroup.length === group.length) {
      for (const [index, entry] of group.entries()) {
        const match = storedGroup[index]!;
        claimed.add(match.id);
        outcomes.set(entry.candidate, {
          kind: "duplicate",
          transactionId: match.id,
          tier: "content",
          narrativeVariant: false,
        });
      }
    } else {
      // Incoming and stored counts differ in the overlap: the whole group is
      // ambiguous and the operator decides which occurrence is new.
      for (const entry of group) {
        outcomes.set(entry.candidate, {
          kind: "ambiguous",
          options: storedGroup.map((transaction) => transaction.id),
        });
      }
    }
  }

  return candidates.map((candidate) => ({ candidate, result: outcomes.get(candidate)! }));
});

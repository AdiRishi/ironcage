import type {
  AmbiguityId,
  BankAccountId,
  BankTransactionId,
  CalendarDate,
  Money,
} from "@ironcage/domain";
import { BigDecimal, Option } from "effect";

import type { CommBankPairedRow } from "./commbank/bundle";
import { narrativeFingerprint } from "./normalization";

export interface StoredTransactionEvidence {
  readonly transactionId: BankTransactionId;
  readonly accountId: BankAccountId;
  readonly postedDate: CalendarDate;
  readonly amount: Money;
  readonly preferredNarrative: string;
  readonly observations: readonly {
    readonly sourceProfile: string;
    readonly bankIdentifier: string | null;
    readonly rowBalance: Money | null;
    readonly narrativeFingerprint: string;
    readonly equalRowOccurrence: number;
  }[];
}

export type DedupeVerdict =
  | { readonly _tag: "New"; readonly row: CommBankPairedRow }
  | {
      readonly _tag: "Duplicate";
      readonly row: CommBankPairedRow;
      readonly transactionId: BankTransactionId;
      readonly matchTier: "bank_identifier" | "row_balance" | "content_occurrence";
      readonly narrativeChanged: boolean;
    }
  | {
      readonly _tag: "Ambiguous";
      readonly row: CommBankPairedRow;
      readonly id: AmbiguityId;
      readonly candidateTransactionIds: readonly BankTransactionId[];
    };

export interface UnidentifiedAmbiguity {
  readonly row: CommBankPairedRow;
  readonly candidateTransactionIds: readonly BankTransactionId[];
}

export type UnidentifiedDedupeVerdict =
  | Exclude<DedupeVerdict, { readonly _tag: "Ambiguous" }>
  | ({ readonly _tag: "Ambiguous" } & UnidentifiedAmbiguity);

export interface SourceIdentifierConflict {
  readonly identifier: string;
  readonly storedTransactionId: BankTransactionId;
  readonly storedDate: CalendarDate;
  readonly incomingDate: CalendarDate;
  readonly storedAmount: Money;
  readonly incomingAmount: Money;
}

export type DedupeResult =
  | { readonly _tag: "Matched"; readonly verdicts: readonly UnidentifiedDedupeVerdict[] }
  | { readonly _tag: "SourceIdentifierConflict"; readonly conflict: SourceIdentifierConflict };

const amountKey = (amount: Money) => BigDecimal.format(BigDecimal.normalize(amount));

const rowBalanceKey = (row: CommBankPairedRow) => {
  const balance = Option.getOrNull(row.csv.rowBalance);

  return balance === null
    ? null
    : JSON.stringify([row.postedDate, amountKey(row.amount), amountKey(balance)]);
};

const contentKey = (date: CalendarDate, amount: Money, fingerprint: string) =>
  JSON.stringify([date, amountKey(amount), fingerprint]);

const transactionIds = (transactions: readonly StoredTransactionEvidence[]) =>
  [...new Set(transactions.map((transaction) => transaction.transactionId))].sort();

interface ContentOccurrenceEvidence {
  readonly occurrence: number;
  readonly transaction: StoredTransactionEvidence;
}

const occurrenceTransactionIds = (
  evidence: readonly ContentOccurrenceEvidence[],
  occurrence: number,
) =>
  transactionIds(
    evidence
      .filter((candidate) => candidate.occurrence === occurrence)
      .map((candidate) => candidate.transaction),
  );

export const deduplicateStructuredRows = (
  rows: readonly CommBankPairedRow[],
  stored: readonly StoredTransactionEvidence[],
): DedupeResult => {
  const byIdentifier = new Map<string, StoredTransactionEvidence>();
  const byRowBalance = new Map<string, StoredTransactionEvidence[]>();
  const byContent = new Map<string, ContentOccurrenceEvidence[]>();

  for (const transaction of stored) {
    for (const observation of transaction.observations) {
      if (observation.bankIdentifier !== null) {
        byIdentifier.set(
          `${observation.sourceProfile}\u0000${observation.bankIdentifier}`,
          transaction,
        );
      }

      if (observation.rowBalance !== null) {
        const key = JSON.stringify([
          transaction.postedDate,
          amountKey(transaction.amount),
          amountKey(observation.rowBalance),
        ]);
        byRowBalance.set(key, [...(byRowBalance.get(key) ?? []), transaction]);
      }

      const key = contentKey(
        transaction.postedDate,
        transaction.amount,
        observation.narrativeFingerprint,
      );
      byContent.set(key, [
        ...(byContent.get(key) ?? []),
        { occurrence: observation.equalRowOccurrence, transaction },
      ]);
    }
  }

  const incomingGroupCounts = new Map<string, number>();

  for (const row of rows) {
    const key = contentKey(row.postedDate, row.amount, narrativeFingerprint(row.narrative));
    incomingGroupCounts.set(key, (incomingGroupCounts.get(key) ?? 0) + 1);
  }

  const claimed = new Set<BankTransactionId>();
  const verdicts: UnidentifiedDedupeVerdict[] = [];

  for (const row of rows) {
    const identifier = Option.getOrNull(row.ofx.identifier);

    if (identifier !== null) {
      const transaction = byIdentifier.get(`cba-netbank-paired-v1\u0000${identifier}`);

      if (transaction !== undefined) {
        if (
          transaction.postedDate !== row.postedDate ||
          !BigDecimal.equals(transaction.amount, row.amount)
        ) {
          return {
            _tag: "SourceIdentifierConflict",
            conflict: {
              identifier,
              storedTransactionId: transaction.transactionId,
              storedDate: transaction.postedDate,
              incomingDate: row.postedDate,
              storedAmount: transaction.amount,
              incomingAmount: row.amount,
            },
          };
        }

        claimed.add(transaction.transactionId);
        verdicts.push({
          _tag: "Duplicate",
          row,
          transactionId: transaction.transactionId,
          matchTier: "bank_identifier",
          narrativeChanged:
            narrativeFingerprint(transaction.preferredNarrative) !==
            narrativeFingerprint(row.narrative),
        });
        continue;
      }
    }

    const balanceKey = rowBalanceKey(row);
    const balanceCandidates =
      balanceKey === null
        ? []
        : transactionIds(
            (byRowBalance.get(balanceKey) ?? []).filter(
              (transaction) => !claimed.has(transaction.transactionId),
            ),
          );

    if (balanceCandidates.length === 1) {
      const transactionId = balanceCandidates[0]!;
      const transaction = stored.find((candidate) => candidate.transactionId === transactionId)!;
      claimed.add(transactionId);
      verdicts.push({
        _tag: "Duplicate",
        row,
        transactionId,
        matchTier: "row_balance",
        narrativeChanged:
          narrativeFingerprint(transaction.preferredNarrative) !==
          narrativeFingerprint(row.narrative),
      });
      continue;
    }

    if (balanceCandidates.length > 1) {
      verdicts.push({ _tag: "Ambiguous", row, candidateTransactionIds: balanceCandidates });
      continue;
    }

    const key = contentKey(row.postedDate, row.amount, narrativeFingerprint(row.narrative));
    const contentEvidence = byContent.get(key) ?? [];
    const contentTransactions = transactionIds(
      contentEvidence.map((candidate) => candidate.transaction),
    );
    const incomingCount = incomingGroupCounts.get(key)!;

    if (contentTransactions.length > 0 && contentTransactions.length !== incomingCount) {
      verdicts.push({ _tag: "Ambiguous", row, candidateTransactionIds: contentTransactions });
      continue;
    }

    const occurrenceCandidates = occurrenceTransactionIds(contentEvidence, row.occurrence).filter(
      (transactionId) => !claimed.has(transactionId),
    );

    if (occurrenceCandidates.length === 1) {
      const occurrenceCandidate = occurrenceCandidates[0]!;
      claimed.add(occurrenceCandidate);
      verdicts.push({
        _tag: "Duplicate",
        row,
        transactionId: occurrenceCandidate,
        matchTier: "content_occurrence",
        narrativeChanged: false,
      });
      continue;
    }

    if (occurrenceCandidates.length > 1 || contentTransactions.length > 0) {
      verdicts.push({ _tag: "Ambiguous", row, candidateTransactionIds: contentTransactions });
      continue;
    }

    verdicts.push({ _tag: "New", row });
  }

  return { _tag: "Matched", verdicts };
};

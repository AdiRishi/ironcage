import {
  AmbiguityId,
  BankAccountId,
  BankTransactionId,
  CalendarDate,
  formatMoney,
  Money,
} from "@ironcage/domain";
import { BigDecimal, Option } from "effect";

import type { CommBankPairedRow } from "./commbank/bundle";
import { commBankPairedProfileId } from "./commbank/profiles";
import { normalizeNarrative } from "./normalization";

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

const balanceKey = (date: CalendarDate, amount: Money, balance: Money) =>
  JSON.stringify([date, formatMoney(amount), formatMoney(balance)]);

const contentKey = (date: CalendarDate, amount: Money, fingerprint: string) =>
  JSON.stringify([date, formatMoney(amount), fingerprint]);

const identifierKey = (sourceProfile: string, identifier: string) =>
  JSON.stringify([sourceProfile, identifier]);

const append = <Key, Value>(index: Map<Key, Value[]>, key: Key, value: Value) => {
  const group = index.get(key);

  if (group === undefined) index.set(key, [value]);
  else group.push(value);
};

const transactionIds = (transactions: readonly StoredTransactionEvidence[]) =>
  [...new Set(transactions.map((transaction) => transaction.transactionId))].sort((left, right) =>
    left.localeCompare(right),
  );

const duplicate = (
  row: CommBankPairedRow,
  transaction: StoredTransactionEvidence,
  matchTier: Extract<DedupeVerdict, { readonly _tag: "Duplicate" }>["matchTier"],
): UnidentifiedDedupeVerdict => ({
  _tag: "Duplicate",
  row,
  transactionId: transaction.transactionId,
  matchTier,
  narrativeChanged:
    normalizeNarrative(transaction.preferredNarrative) !== normalizeNarrative(row.narrative),
});

interface ContentOccurrenceEvidence {
  readonly occurrence: number;
  readonly transaction: StoredTransactionEvidence;
}

export const deduplicateStructuredRows = (
  rows: readonly CommBankPairedRow[],
  stored: readonly StoredTransactionEvidence[],
): DedupeResult => {
  const byIdentifier = new Map<string, StoredTransactionEvidence>();
  const byRowBalance = new Map<string, StoredTransactionEvidence[]>();
  const byContent = new Map<string, ContentOccurrenceEvidence[]>();
  const balanceProven = new Set<BankTransactionId>();

  for (const transaction of stored) {
    for (const observation of transaction.observations) {
      if (observation.bankIdentifier !== null) {
        byIdentifier.set(
          identifierKey(observation.sourceProfile, observation.bankIdentifier),
          transaction,
        );
      }

      if (observation.rowBalance !== null) {
        balanceProven.add(transaction.transactionId);
        append(
          byRowBalance,
          balanceKey(transaction.postedDate, transaction.amount, observation.rowBalance),
          transaction,
        );
      }

      append(
        byContent,
        contentKey(transaction.postedDate, transaction.amount, observation.narrativeFingerprint),
        { occurrence: observation.equalRowOccurrence, transaction },
      );
    }
  }

  const incomingGroupCounts = new Map<string, number>();

  for (const row of rows) {
    const key = contentKey(row.postedDate, row.amount, normalizeNarrative(row.narrative));
    incomingGroupCounts.set(key, (incomingGroupCounts.get(key) ?? 0) + 1);
  }

  const claimed = new Set<BankTransactionId>();
  const verdicts: UnidentifiedDedupeVerdict[] = [];

  for (const row of rows) {
    const identifier = Option.getOrNull(row.ofx.identifier);

    if (identifier !== null) {
      const transaction = byIdentifier.get(identifierKey(commBankPairedProfileId, identifier));

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
        verdicts.push(duplicate(row, transaction, "bank_identifier"));
        continue;
      }
    }

    const rowBalance = Option.getOrNull(row.csv.rowBalance);
    const balanceCandidates =
      rowBalance === null
        ? []
        : (byRowBalance.get(balanceKey(row.postedDate, row.amount, rowBalance)) ?? []).filter(
            (transaction) => !claimed.has(transaction.transactionId),
          );

    if (balanceCandidates.length === 1) {
      const transaction = balanceCandidates[0]!;

      claimed.add(transaction.transactionId);
      verdicts.push(duplicate(row, transaction, "row_balance"));
      continue;
    }

    if (balanceCandidates.length > 1) {
      verdicts.push({
        _tag: "Ambiguous",
        row,
        candidateTransactionIds: transactionIds(balanceCandidates),
      });
      continue;
    }

    // A row balance that matched nothing is decisive against any stored
    // transaction whose own balance position is recorded: the bank placed the
    // two rows at different points in one chain, so they are different
    // movements however identically their narratives read. Content and
    // occurrence decide only what no balance has already answered.
    const key = contentKey(row.postedDate, row.amount, normalizeNarrative(row.narrative));
    const contentEvidence = (byContent.get(key) ?? []).filter(
      (candidate) => rowBalance === null || !balanceProven.has(candidate.transaction.transactionId),
    );
    const contentTransactions = transactionIds(
      contentEvidence.map((candidate) => candidate.transaction),
    );

    if (
      contentTransactions.length > 0 &&
      contentTransactions.length !== incomingGroupCounts.get(key)
    ) {
      verdicts.push({ _tag: "Ambiguous", row, candidateTransactionIds: contentTransactions });
      continue;
    }

    const occurrenceCandidates = contentEvidence
      .filter(
        (candidate) =>
          candidate.occurrence === row.occurrence &&
          !claimed.has(candidate.transaction.transactionId),
      )
      .map((candidate) => candidate.transaction);
    const occurrenceIds = transactionIds(occurrenceCandidates);

    if (occurrenceIds.length === 1) {
      claimed.add(occurrenceIds[0]!);
      verdicts.push(duplicate(row, occurrenceCandidates[0]!, "content_occurrence"));
      continue;
    }

    if (occurrenceIds.length > 1 || contentTransactions.length > 0) {
      verdicts.push({ _tag: "Ambiguous", row, candidateTransactionIds: contentTransactions });
      continue;
    }

    verdicts.push({ _tag: "New", row });
  }

  return { _tag: "Matched", verdicts };
};

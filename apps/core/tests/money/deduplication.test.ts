import {
  BankAccountId,
  BankTransactionId,
  CalendarDate,
  Money,
  type BankAccountId as BankAccountIdType,
  type BankTransactionId as BankTransactionIdType,
} from "@ironcage/domain";
import { Option, Schema } from "effect";
import { describe, expect, it } from "vitest";

import type { CommBankPairedRow } from "../../src/money/commbank/bundle";
import {
  deduplicateStructuredRows,
  type StoredTransactionEvidence,
} from "../../src/money/deduplication";

const decodeAccountId = Schema.decodeUnknownSync(BankAccountId);
const decodeTransactionId = Schema.decodeUnknownSync(BankTransactionId);
const decodeDate = Schema.decodeUnknownSync(CalendarDate);
const decodeMoney = Schema.decodeUnknownSync(Money);

const accountId = decodeAccountId("018f0000-0000-7000-8000-000000001001");
const firstId = decodeTransactionId("018f0000-0000-7000-8000-000000001002");
const secondId = decodeTransactionId("018f0000-0000-7000-8000-000000001001");
const postedDate = decodeDate("2026-07-29");
const amount = decodeMoney("-25");
const narrative = "FIXTURE CAFE";

const incomingRow = (occurrence: number): CommBankPairedRow => ({
  occurrence,
  postedDate,
  amount,
  narrative,
  csv: {
    sourceOrdinal: occurrence - 1,
    raw: { date: "29/07/2026", amount: "-25.00", narrative, balance: "" },
    postedDate,
    amount,
    rowBalance: Option.none(),
  },
  ofx: {
    sourceOrdinal: occurrence - 1,
    raw: {
      type: "DEBIT",
      postedDate: "20260729",
      userDate: "20260729",
      amount: "-25.00",
      identifier: "",
      narrative,
    },
    type: "DEBIT",
    postedDate,
    userDate: postedDate,
    amount,
    identifier: Option.none(),
    narrative,
  },
});

const storedTransaction = (
  transactionId: BankTransactionIdType,
  accountId: BankAccountIdType,
  occurrence: number,
): StoredTransactionEvidence => ({
  transactionId,
  accountId,
  postedDate,
  amount,
  preferredNarrative: narrative,
  observations: [
    {
      sourceProfile: "cba-netbank-paired-v1",
      bankIdentifier: null,
      rowBalance: null,
      narrativeFingerprint: "fixture cafe",
      equalRowOccurrence: occurrence,
    },
  ],
});

describe("structured import deduplication", () => {
  it("claims repeated equal rows by recorded occurrence, not transaction ID order", () => {
    const result = deduplicateStructuredRows(
      [incomingRow(1), incomingRow(2)],
      [storedTransaction(firstId, accountId, 1), storedTransaction(secondId, accountId, 2)],
    );

    expect(result).toMatchObject({
      _tag: "Matched",
      verdicts: [
        { _tag: "Duplicate", transactionId: firstId, matchTier: "content_occurrence" },
        { _tag: "Duplicate", transactionId: secondId, matchTier: "content_occurrence" },
      ],
    });
  });
});

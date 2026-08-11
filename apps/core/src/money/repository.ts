import type {
  ArchivedBankStatement,
  BankAccount,
  BankBalanceObservationId,
  BankCoverageSegmentId,
  BankImportHistoryItem,
  BankImportPreview,
  BankMonthCoverageObservationId,
  BankObservationId,
  BankSourceFileId,
  BankTransactionId,
  CalendarDate,
  CalendarMonth,
  CategoryId,
  ConfirmedBankImport,
  FeedEventId,
  Money,
  RequestId,
  Sha256,
  TransactionClassificationId,
  TransactionSplitId,
  TransferMatchId,
} from "@ironcage/domain";
import { Context, Effect, Schema } from "effect";

import type { PersistenceError, StoredRequest } from "../persistence";
import type { CoverageSegment } from "./coverage";
import type { StoredTransactionEvidence } from "./deduplication";

export class MoneyAccountMissing extends Schema.TaggedError<MoneyAccountMissing>()(
  "MoneyAccountMissing",
  { accountId: Schema.String },
) {}

export interface StoredBankAccount {
  readonly account: BankAccount;
  readonly identityHmac: Sha256;
}

export interface StoredImport {
  readonly bundleDigest: Sha256;
  readonly result: unknown;
  readonly preview: unknown;
}

export interface StoredStatementArchive {
  readonly digest: Sha256;
  readonly result: unknown;
}

export interface StoredCategorizationRule {
  readonly id: string;
  readonly version: number;
  readonly accountIds: readonly string[];
  readonly direction: "debit" | "credit" | "either";
  readonly payeeEquals: string | null;
  readonly narrativeIncludes: readonly string[];
  readonly minimumAbsoluteAmount: Money | null;
  readonly maximumAbsoluteAmount: Money | null;
  readonly categoryId: CategoryId;
  readonly effectiveFrom: CalendarDate;
}

export interface ImportSnapshot {
  readonly selectedAccount: StoredBankAccount;
  readonly accounts: readonly BankAccount[];
  readonly transactions: readonly StoredTransactionEvidence[];
  readonly coverage: readonly CoverageSegment[];
  readonly rules: readonly StoredCategorizationRule[];
  readonly imports: readonly StoredImport[];
  readonly statementArchives: readonly StoredStatementArchive[];
  readonly requests: readonly StoredRequest[];
  readonly transferPairs: readonly {
    readonly debitTransactionId: BankTransactionId;
    readonly creditTransactionId: BankTransactionId;
    readonly status: "proposed" | "confirmed" | "rejected";
  }[];
}

export type AccountRegistrationOutcome =
  | { readonly _tag: "Applied"; readonly account: BankAccount }
  | { readonly _tag: "Replay"; readonly response: unknown }
  | { readonly _tag: "RequestConflict"; readonly existingPayloadHash: Sha256 }
  | { readonly _tag: "IdentityConflict"; readonly existingAccountId: BankAccount["id"] }
  | {
      readonly _tag: "AccountConflict";
      readonly field: "id" | "label" | "profile";
      readonly existingAccountId: BankAccount["id"];
    };

export interface SourceFilePlan {
  readonly id: BankSourceFileId;
  readonly role: "csv" | "ofx";
  readonly mediaType: string;
  readonly byteDigest: Sha256;
  readonly r2Key: string;
  readonly originalName: string;
  readonly byteLength: number;
}

export interface TransactionPlan {
  readonly id: BankTransactionId;
  readonly postedDate: CalendarDate;
  readonly amount: Money;
  readonly preferredNarrative: string;
}

export interface ObservationPlan {
  readonly id: BankObservationId;
  readonly sourceFileId: BankSourceFileId;
  readonly sourceOrdinal: number;
  readonly sourceKind: "csv" | "ofx";
  readonly rawFields: Readonly<Record<string, string>>;
  readonly parsedFields: Readonly<Record<string, string>>;
  readonly postedDate: CalendarDate;
  readonly amount: Money;
  readonly rowBalance: Money | null;
  readonly bankIdentifier: string | null;
  readonly narrativeFingerprint: string;
  readonly equalRowOccurrence: number;
  readonly transactionId: BankTransactionId;
  readonly matchTier: "new" | "bank_identifier" | "row_balance" | "content_occurrence" | "manual";
  readonly provenance: Readonly<Record<string, string>>;
}

export interface BalanceObservationPlan {
  readonly id: BankBalanceObservationId;
  readonly kind: "row" | "ledger" | "available";
  readonly value: Money;
  readonly sourceValue: Money;
  readonly asOfDate: CalendarDate;
  readonly sourceObservationId: BankObservationId | null;
  readonly sourceFileId: BankSourceFileId | null;
}

export interface ClassificationPlan {
  readonly id: TransactionClassificationId;
  readonly transactionId: BankTransactionId;
  readonly provenance: "rule" | "manual" | "system";
  readonly sourceId: string | null;
  readonly sourceVersion: number | null;
  readonly amount: Money;
  readonly split: {
    readonly id: TransactionSplitId;
    readonly categoryId: CategoryId;
    readonly amount: Money;
  };
}

export interface TransferPlan {
  readonly id: TransferMatchId;
  readonly debitTransactionId: BankTransactionId;
  readonly creditTransactionId: BankTransactionId;
  readonly status: "proposed" | "confirmed";
  readonly method: "unique" | "reference" | "amount_date";
  readonly provenance: Readonly<Record<string, string>>;
}

export interface CoverageStatusPlan {
  readonly id: BankMonthCoverageObservationId;
  readonly accountId: BankAccount["id"];
  readonly month: CalendarMonth;
  readonly complete: boolean;
  readonly eventId: FeedEventId;
}

export interface ConfirmedImportPlan {
  readonly result: ConfirmedBankImport;
  readonly preview: BankImportPreview;
  readonly requestId: RequestId;
  readonly requestPayloadHash: Sha256;
  readonly previewFingerprint: Sha256;
  readonly sourceProfile: string;
  readonly sourceFiles: readonly SourceFilePlan[];
  readonly transactions: readonly TransactionPlan[];
  readonly observations: readonly ObservationPlan[];
  readonly balances: readonly BalanceObservationPlan[];
  readonly coverage: {
    readonly id: BankCoverageSegmentId;
    readonly start: CalendarDate;
    readonly end: CalendarDate;
  };
  readonly classifications: readonly ClassificationPlan[];
  readonly transfers: readonly TransferPlan[];
  readonly coverageStatuses: readonly CoverageStatusPlan[];
  readonly feedEvent: {
    readonly id: FeedEventId;
    readonly payload: Readonly<Record<string, string | number>>;
  };
}

export interface StatementArchivePlan {
  readonly result: ArchivedBankStatement;
  readonly requestId: RequestId;
  readonly requestPayloadHash: Sha256;
  readonly originalName: string;
  readonly mediaType: string;
  readonly byteLength: number;
}

export interface MoneyTransaction {
  readonly snapshot: Effect.Effect<ImportSnapshot, PersistenceError | MoneyAccountMissing>;
  readonly commitImport: (
    plan: ConfirmedImportPlan,
  ) => Effect.Effect<ConfirmedBankImport, PersistenceError>;
  readonly commitStatementArchive: (
    plan: StatementArchivePlan,
  ) => Effect.Effect<ArchivedBankStatement, PersistenceError>;
}

export class MoneyImportRepository extends Context.Service<
  MoneyImportRepository,
  {
    readonly listAccounts: Effect.Effect<readonly BankAccount[], PersistenceError>;
    readonly registerAccount: (input: {
      readonly account: StoredBankAccount;
      readonly requestId: RequestId;
      readonly requestPayloadHash: Sha256;
    }) => Effect.Effect<AccountRegistrationOutcome, PersistenceError>;
    readonly snapshot: (
      accountId: BankAccount["id"],
    ) => Effect.Effect<ImportSnapshot, PersistenceError | MoneyAccountMissing>;
    readonly withAccountTransaction: <A, E, R>(
      accountId: BankAccount["id"],
      use: (transaction: MoneyTransaction) => Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E | PersistenceError | MoneyAccountMissing, R>;
    readonly importHistory: (
      accountId: BankAccount["id"] | null,
    ) => Effect.Effect<readonly BankImportHistoryItem[], PersistenceError>;
  }
>()("ironcage/core/money/MoneyImportRepository") {}

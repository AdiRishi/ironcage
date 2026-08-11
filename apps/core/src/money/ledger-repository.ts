import type {
  AccountBalance,
  BankTransactionId,
  BankTransactionRecord,
  CategorizationReviewItem,
  CategorizationRule,
  Category,
  FeedEventId,
  Money,
  MonthlySpendingReport,
  RequestId,
  Sha256,
  TransactionClassificationId,
  TransactionSplitId,
  TransferCandidate,
} from "@ironcage/domain";
import { Context, Effect, type DateTime } from "effect";

import type { PersistenceError, StoredRequest } from "../persistence";
import type { MoneyAnalysisRecord } from "./analysis";

export interface MoneyLedgerSnapshot {
  readonly analysis: MoneyAnalysisRecord;
  readonly categories: readonly Category[];
  readonly rules: readonly CategorizationRule[];
  readonly review: readonly CategorizationReviewItem[];
  readonly transfers: readonly TransferCandidate[];
  readonly confirmedTransferTransactionIds: readonly BankTransactionId[];
  readonly balances: readonly AccountBalance[];
  readonly reports: readonly MonthlySpendingReport[];
  readonly requests: readonly StoredRequest[];
}

interface MutationPlan<Response> {
  readonly requestId: RequestId;
  readonly payloadHash: Sha256;
  readonly response: Response;
}

export interface CreateCategoryPlan extends MutationPlan<Category> {}

export interface RenameCategoryPlan extends MutationPlan<Category> {}

export interface CategorizePlan extends MutationPlan<{ readonly requestId: RequestId }> {
  readonly classifications: readonly {
    readonly id: TransactionClassificationId;
    readonly transactionId: BankTransactionId;
    readonly provenance: "manual" | "ai";
    readonly sourceId: string | null;
    readonly sourceVersion: null;
    readonly amount: Money;
    readonly splits: readonly {
      readonly id: TransactionSplitId;
      readonly categoryId: Category["id"];
      readonly amount: Money;
    }[];
    readonly acceptedSuggestionId: string | null;
  }[];
  readonly recordedAt: DateTime.Utc;
}

export interface EditRulePlan extends MutationPlan<CategorizationRule> {}

export interface ResolveTransferPlan extends MutationPlan<{ readonly requestId: RequestId }> {
  readonly transferId: TransferCandidate["id"];
  readonly decision: "confirmed" | "rejected";
}

export interface SaveReportPlan extends MutationPlan<MonthlySpendingReport> {
  readonly feedEventId: FeedEventId;
  readonly analysisEvents: readonly {
    readonly identity: {
      readonly rule: string;
      readonly subject: string;
      readonly month: string;
    };
    readonly id: FeedEventId;
    readonly eventType: "recurring_price_change" | "spending_anomaly";
    readonly severity: "notice";
    readonly summary: string;
    readonly payload: Readonly<Record<string, string>>;
  }[];
}

export interface MarkReportReadPlan extends MutationPlan<MonthlySpendingReport> {
  readonly readAt: DateTime.Utc;
}

export interface MoneyLedgerTransaction {
  readonly snapshot: Effect.Effect<MoneyLedgerSnapshot, PersistenceError>;
  readonly createCategory: (plan: CreateCategoryPlan) => Effect.Effect<Category, PersistenceError>;
  readonly renameCategory: (plan: RenameCategoryPlan) => Effect.Effect<Category, PersistenceError>;
  readonly categorize: (
    plan: CategorizePlan,
  ) => Effect.Effect<{ readonly requestId: RequestId }, PersistenceError>;
  readonly editRule: (plan: EditRulePlan) => Effect.Effect<CategorizationRule, PersistenceError>;
  readonly resolveTransfer: (
    plan: ResolveTransferPlan,
  ) => Effect.Effect<{ readonly requestId: RequestId }, PersistenceError>;
  readonly saveReport: (
    plan: SaveReportPlan,
  ) => Effect.Effect<MonthlySpendingReport, PersistenceError>;
  readonly markReportRead: (
    plan: MarkReportReadPlan,
  ) => Effect.Effect<MonthlySpendingReport, PersistenceError>;
}

export class MoneyLedgerRepository extends Context.Service<
  MoneyLedgerRepository,
  {
    readonly snapshot: Effect.Effect<MoneyLedgerSnapshot, PersistenceError>;
    readonly transactions: (
      ids: readonly BankTransactionId[],
    ) => Effect.Effect<readonly BankTransactionRecord[], PersistenceError>;
    readonly withTransaction: <A, E, R>(
      use: (transaction: MoneyLedgerTransaction) => Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E | PersistenceError, R>;
  }
>()("ironcage/core/money/MoneyLedgerRepository") {}

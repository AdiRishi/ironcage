import {
  AccountBalance,
  AmbiguityId,
  ArchivedBankStatement,
  BankAccount,
  BankAccountId,
  BankImportHistoryItem,
  BankImportPreview,
  BankImportSource,
  BankTransactionId,
  BankTransactionRecord,
  CalendarDate,
  CalendarMonth,
  CategorizationReviewItem,
  CategorizationRule,
  CategorizationRuleId,
  CategorizationRulePredicate,
  CategorizeTransactions,
  Category,
  CategoryId,
  CategoryKind,
  ConfirmedBankImport,
  CoverageGap,
  MoneyAnalysis,
  MonthlySpendingReport,
  RegisterBankAccount,
  ReportId,
  RequestId,
  Sha256,
  TransferCandidate,
  TransferMatchId,
  UploadedBytes,
} from "@ironcage/domain";
import { Schema } from "effect";
import { Rpc as RpcModule } from "effect/unstable/rpc";

import { BoundaryError } from "./errors";

const mutationResult = Schema.Struct({ requestId: RequestId });

export const registerBankAccountRpc = RpcModule.make("registerBankAccount", {
  payload: { account: RegisterBankAccount, requestId: RequestId },
  success: BankAccount,
  error: BoundaryError,
});

export const listBankAccountsRpc = RpcModule.make("listBankAccounts", {
  success: Schema.Array(BankAccount),
  error: BoundaryError,
});

export const previewBankImportRpc = RpcModule.make("previewBankImport", {
  payload: { source: BankImportSource },
  success: BankImportPreview,
  error: BoundaryError,
});

export const confirmBankImportRpc = RpcModule.make("confirmBankImport", {
  payload: {
    source: BankImportSource,
    expectedBundleDigest: Sha256,
    expectedPreviewFingerprint: Sha256,
    resolutions: Schema.Array(
      Schema.Struct({
        ambiguityId: AmbiguityId,
        decision: Schema.Union([
          Schema.Struct({ _tag: Schema.Literal("New") }),
          Schema.Struct({ _tag: Schema.Literal("Existing"), transactionId: BankTransactionId }),
        ]),
      }),
    ),
    requestId: RequestId,
  },
  success: ConfirmedBankImport,
  error: BoundaryError,
});

export const archiveBankStatementRpc = RpcModule.make("archiveBankStatement", {
  payload: { accountId: BankAccountId, pdf: UploadedBytes, requestId: RequestId },
  success: ArchivedBankStatement,
  error: BoundaryError,
});

export const getImportHistoryRpc = RpcModule.make("getImportHistory", {
  payload: { accountId: Schema.NullOr(BankAccountId) },
  success: Schema.Array(BankImportHistoryItem),
  error: BoundaryError,
});

export const getBankCoverageRpc = RpcModule.make("getBankCoverage", {
  payload: { start: CalendarDate, end: CalendarDate },
  success: Schema.Struct({ gaps: Schema.Array(CoverageGap) }),
  error: BoundaryError,
});

export const listCategoriesRpc = RpcModule.make("listCategories", {
  success: Schema.Array(Category),
  error: BoundaryError,
});

export const createCategoryRpc = RpcModule.make("createCategory", {
  payload: {
    id: CategoryId,
    name: Schema.String.check(Schema.isMinLength(1)),
    kind: CategoryKind,
    requestId: RequestId,
  },
  success: Category,
  error: BoundaryError,
});

export const renameCategoryRpc = RpcModule.make("renameCategory", {
  payload: {
    id: CategoryId,
    expectedVersion: Schema.Int,
    name: Schema.String.check(Schema.isMinLength(1)),
    requestId: RequestId,
  },
  success: Category,
  error: BoundaryError,
});

export const getCategorizationReviewRpc = RpcModule.make("getCategorizationReview", {
  success: Schema.Array(CategorizationReviewItem),
  error: BoundaryError,
});

export const categorizeTransactionsRpc = RpcModule.make("categorizeTransactions", {
  payload: CategorizeTransactions.fields,
  success: mutationResult,
  error: BoundaryError,
});

export const getCategorizationRulesRpc = RpcModule.make("getCategorizationRules", {
  success: Schema.Array(CategorizationRule),
  error: BoundaryError,
});

export const editCategorizationRuleRpc = RpcModule.make("editCategorizationRule", {
  payload: {
    id: Schema.NullOr(CategorizationRuleId),
    expectedVersion: Schema.NullOr(Schema.Int),
    name: Schema.String.check(Schema.isMinLength(1)),
    predicate: CategorizationRulePredicate,
    categoryId: CategoryId,
    effectiveFrom: CalendarDate,
    retired: Schema.Boolean,
    requestId: RequestId,
  },
  success: CategorizationRule,
  error: BoundaryError,
});

export const getTransferReviewRpc = RpcModule.make("getTransferReview", {
  success: Schema.Array(TransferCandidate),
  error: BoundaryError,
});

export const resolveTransferMatchRpc = RpcModule.make("resolveTransferMatch", {
  payload: {
    id: TransferMatchId,
    decision: Schema.Literals(["confirmed", "rejected"]),
    requestId: RequestId,
  },
  success: mutationResult,
  error: BoundaryError,
});

export const getMoneyAnalysisRpc = RpcModule.make("getMoneyAnalysis", {
  payload: { startMonth: CalendarMonth, endMonth: CalendarMonth },
  success: MoneyAnalysis,
  error: BoundaryError,
});

export const getAccountBalancesRpc = RpcModule.make("getAccountBalances", {
  success: Schema.Array(AccountBalance),
  error: BoundaryError,
});

export const getBankTransactionsRpc = RpcModule.make("getBankTransactions", {
  payload: {
    ids: Schema.Array(BankTransactionId).check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  },
  success: Schema.Array(BankTransactionRecord),
  error: BoundaryError,
});

export const generateMonthlySpendingReportRpc = RpcModule.make("generateMonthlySpendingReport", {
  payload: { month: CalendarMonth, requestId: RequestId },
  success: MonthlySpendingReport,
  error: BoundaryError,
});

export const listMonthlySpendingReportsRpc = RpcModule.make("listMonthlySpendingReports", {
  success: Schema.Array(MonthlySpendingReport),
  error: BoundaryError,
});

export const getMonthlySpendingReportRpc = RpcModule.make("getMonthlySpendingReport", {
  payload: { id: ReportId },
  success: Schema.Struct({ report: MonthlySpendingReport, html: Schema.String }),
  error: BoundaryError,
});

export const markMonthlySpendingReportReadRpc = RpcModule.make("markMonthlySpendingReportRead", {
  payload: { id: ReportId, requestId: RequestId },
  success: MonthlySpendingReport,
  error: BoundaryError,
});

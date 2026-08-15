import {
  Aud,
  BankAccountId,
  BankAccountType,
  BankImportId,
  BankTransactionId,
  CalendarDate,
  CandidateStatus,
  CategorizationRuleId,
  CategoryId,
  CategoryKind,
  ImportBlock,
  Instant,
  MatchTier,
  RequestId,
  RulePredicate,
  Sha256,
  SourceFileRole,
  SourceProfile,
  SplitProvenance,
  TransferMatchId,
  TransferMatchMethod,
  TransferMatchStatus,
} from "@ironcage/domain";
import { Schema } from "effect";
import { Rpc as RpcModule } from "effect/unstable/rpc";

import { Conflict, Internal, NotFound, Stale, ValidationFailed } from "./errors";

const MutationError = Schema.Union([ValidationFailed, NotFound, Conflict, Stale, Internal]);
const ReadError = Schema.Union([NotFound, Internal]);

export const UploadedBytes = Schema.Struct({
  displayName: Schema.String,
  bytes: Schema.Uint8Array,
});
export type UploadedBytes = typeof UploadedBytes.Type;

/**
 * The two explicit import operations — a structured CSV/OFX pair or one
 * statement PDF — rather than a mode flag. The account is the operator's
 * selection; the files must prove it.
 */
export const BankImportSource = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("commbank_structured"),
    accountId: BankAccountId,
    csv: UploadedBytes,
    ofx: UploadedBytes,
  }),
  Schema.Struct({
    kind: Schema.Literal("commbank_statement"),
    accountId: BankAccountId,
    pdf: UploadedBytes,
  }),
]);
export type BankImportSource = typeof BankImportSource.Type;

export const CoverageSpan = Schema.Struct({ start: CalendarDate, end: CalendarDate });
export type CoverageSpan = typeof CoverageSpan.Type;

export const CandidateEffect = Schema.Struct({
  /** Position in source order; the subject key an ambiguity resolution names. */
  ordinal: Schema.Int,
  postedDate: CalendarDate,
  amount: Aud,
  narrative: Schema.String,
  payee: Schema.String,
  status: CandidateStatus,
  tier: Schema.NullOr(MatchTier),
  transactionId: Schema.NullOr(BankTransactionId),
  /** Stored transactions an ambiguous candidate could link to. */
  options: Schema.Array(BankTransactionId),
  narrativeVariant: Schema.Boolean,
  /** The category a rule would apply on confirm; null lands uncategorized. */
  category: Schema.NullOr(Schema.String),
});
export type CandidateEffect = typeof CandidateEffect.Type;

export const ImportEffectCounts = Schema.Struct({
  new: Schema.Int,
  duplicate: Schema.Int,
  ambiguous: Schema.Int,
});
export type ImportEffectCounts = typeof ImportEffectCounts.Type;

export const BankImportPreview = Schema.Struct({
  accountId: BankAccountId,
  sourceProfile: SourceProfile,
  window: CoverageSpan,
  files: Schema.Array(
    Schema.Struct({
      role: SourceFileRole,
      displayName: Schema.String,
      digest: Sha256,
      byteSize: Schema.Int,
    }),
  ),
  bundleDigest: Sha256,
  /** Digest of the matching outcome; confirm proves the record hasn't moved. */
  previewFingerprint: Sha256,
  logicalTransactions: Schema.Int,
  physicalObservations: Schema.Int,
  effects: ImportEffectCounts,
  candidates: Schema.Array(CandidateEffect),
  balances: Schema.Struct({
    ledger: Schema.NullOr(Aud),
    available: Schema.NullOr(Aud),
    ledgerReconciled: Schema.Boolean,
  }),
  coverage: Schema.Struct({
    added: Schema.Array(CoverageSpan),
    overlapRetained: Schema.Array(CoverageSpan),
    gapsRemaining: Schema.Array(CoverageSpan),
  }),
  warnings: Schema.Array(Schema.String),
  /** Rows that will enter the review queue as uncategorized on confirm. */
  reviewCount: Schema.Int,
  /** An identical bundle digest is already confirmed; confirm is a no-op replay. */
  alreadyConfirmed: Schema.Boolean,
});
export type BankImportPreview = typeof BankImportPreview.Type;

export const PreviewBankImportResult = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("ready"), preview: BankImportPreview }),
  Schema.Struct({ kind: Schema.Literal("blocked"), block: ImportBlock }),
]);
export type PreviewBankImportResult = typeof PreviewBankImportResult.Type;

export const AmbiguityResolution = Schema.Struct({
  ordinal: Schema.Int,
  decision: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("link"), transactionId: BankTransactionId }),
    Schema.Struct({ kind: Schema.Literal("new") }),
  ]),
});
export type AmbiguityResolution = typeof AmbiguityResolution.Type;

export const ConfirmBankImportResult = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("confirmed"),
    importId: BankImportId,
    effects: ImportEffectCounts,
    coverageAdded: Schema.Array(CoverageSpan),
  }),
  Schema.Struct({ kind: Schema.Literal("blocked"), block: ImportBlock }),
]);
export type ConfirmBankImportResult = typeof ConfirmBankImportResult.Type;

export const BankAccountSummary = Schema.Struct({
  id: BankAccountId,
  productLabel: Schema.String,
  accountType: BankAccountType,
  /** Null until the first confirmed import binds the bank identity. */
  maskedSuffix: Schema.NullOr(Schema.String),
  identityBound: Schema.Boolean,
  required: Schema.Boolean,
  openedOn: Schema.NullOr(CalendarDate),
  closedOn: Schema.NullOr(CalendarDate),
});
export type BankAccountSummary = typeof BankAccountSummary.Type;

export const BankCoverage = Schema.Struct({
  accounts: Schema.Array(
    Schema.Struct({
      account: BankAccountSummary,
      covered: Schema.Array(CoverageSpan),
      gaps: Schema.Array(CoverageSpan),
    }),
  ),
  completeMonths: Schema.Array(Schema.String),
  /** Latest confirmed import time — the displayed freshness. */
  freshestImportAt: Schema.NullOr(Instant),
  /** Latest covered posted date across required accounts. */
  dataThrough: Schema.NullOr(CalendarDate),
});
export type BankCoverage = typeof BankCoverage.Type;

export const ImportHistoryEntry = Schema.Struct({
  importId: BankImportId,
  accountId: BankAccountId,
  productLabel: Schema.String,
  sourceProfile: SourceProfile,
  window: CoverageSpan,
  effects: ImportEffectCounts,
  files: Schema.Array(
    Schema.Struct({ role: SourceFileRole, displayName: Schema.String, digest: Sha256 }),
  ),
  confirmedAt: Instant,
});
export type ImportHistoryEntry = typeof ImportHistoryEntry.Type;

export const CategorySummary = Schema.Struct({
  id: CategoryId,
  name: Schema.String,
  kind: CategoryKind,
  system: Schema.Boolean,
  archived: Schema.Boolean,
});
export type CategorySummary = typeof CategorySummary.Type;

export const SplitInput = Schema.Struct({
  categoryId: CategoryId,
  amount: Aud,
});
export type SplitInput = typeof SplitInput.Type;

export const EffectiveSplit = Schema.Struct({
  categoryId: CategoryId,
  categoryName: Schema.String,
  amount: Aud,
  provenance: SplitProvenance,
});
export type EffectiveSplit = typeof EffectiveSplit.Type;

export const RuleInput = Schema.Struct({
  predicate: RulePredicate,
  categoryId: CategoryId,
});
export type RuleInput = typeof RuleInput.Type;

export const RuleSummary = Schema.Struct({
  id: CategorizationRuleId,
  predicate: RulePredicate,
  categoryId: CategoryId,
  categoryName: Schema.String,
  createdBy: Schema.Literals(["operator", "correction"]),
  effectiveFrom: Instant,
  effectiveTo: Schema.NullOr(Instant),
});
export type RuleSummary = typeof RuleSummary.Type;

/**
 * One row of the ledger: a bank transaction with its effective splits and who
 * filed them. `filedBy` is the strongest provenance among the splits —
 * `system` means still uncategorized. `rationale` is the model's one-line
 * reason when it did the filing.
 */
export const LedgerEntry = Schema.Struct({
  transactionId: BankTransactionId,
  accountId: BankAccountId,
  productLabel: Schema.String,
  postedDate: CalendarDate,
  amount: Aud,
  narrative: Schema.String,
  payee: Schema.String,
  splits: Schema.Array(EffectiveSplit),
  filedBy: SplitProvenance,
  rationale: Schema.NullOr(Schema.String),
});
export type LedgerEntry = typeof LedgerEntry.Type;

/**
 * Which slice of the ledger to read. A month reads every transaction posted
 * in it; `attention` reads what still needs a hand or was filed by the model,
 * newest first — the working set the operator inspects after an import.
 */
export const LedgerScope = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("month"), month: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("attention") }),
]);
export type LedgerScope = typeof LedgerScope.Type;

export const listCategoriesRpc = RpcModule.make("listCategories", {
  success: Schema.Array(CategorySummary),
  error: ReadError,
});

export const createCategoryRpc = RpcModule.make("createCategory", {
  payload: { requestId: RequestId, name: Schema.String, kind: CategoryKind },
  success: CategorySummary,
  error: MutationError,
});

export const editCategoryRpc = RpcModule.make("editCategory", {
  payload: {
    requestId: RequestId,
    categoryId: CategoryId,
    name: Schema.NullOr(Schema.String),
    archived: Schema.NullOr(Schema.Boolean),
  },
  success: CategorySummary,
  error: MutationError,
});

export const getCategorizationRulesRpc = RpcModule.make("getCategorizationRules", {
  success: Schema.Array(RuleSummary),
  error: ReadError,
});

export const editCategorizationRuleRpc = RpcModule.make("editCategorizationRule", {
  payload: {
    requestId: RequestId,
    action: Schema.Union([
      Schema.Struct({ kind: Schema.Literal("create"), rule: RuleInput }),
      Schema.Struct({ kind: Schema.Literal("close"), ruleId: CategorizationRuleId }),
      Schema.Struct({
        kind: Schema.Literal("replace"),
        ruleId: CategorizationRuleId,
        rule: RuleInput,
      }),
    ]),
  },
  success: RuleSummary,
  error: MutationError,
});

export const categorizeTransactionsRpc = RpcModule.make("categorizeTransactions", {
  payload: {
    requestId: RequestId,
    changes: Schema.Array(
      Schema.Struct({
        transactionId: BankTransactionId,
        splits: Schema.Array(SplitInput),
      }),
    ),
    /** Exact-payee rules created from these corrections, applying forward only. */
    createRules: Schema.Array(RuleInput),
  },
  success: Schema.Struct({ updated: Schema.Int, rulesCreated: Schema.Int }),
  error: MutationError,
});

export const listTransactionsRpc = RpcModule.make("listTransactions", {
  payload: { scope: LedgerScope },
  success: Schema.Array(LedgerEntry),
  error: ReadError,
});

export const MonthCategoryLine = Schema.Struct({
  categoryId: CategoryId,
  name: Schema.String,
  kind: CategoryKind,
  /** Net spend for expense categories (refunds reduce it), income for income. */
  amount: Aud,
});
export type MonthCategoryLine = typeof MonthCategoryLine.Type;

export const MonthAnalysis = Schema.Struct({
  month: Schema.String,
  complete: Schema.Boolean,
  income: Aud,
  netSpend: Aud,
  /** `(income − net spend) / income` to four places; null unless income > 0. */
  savingsRate: Schema.NullOr(Schema.String),
  /** Requires the three preceding calendar months complete; never shortened. */
  trailingThreeMonthNetSpend: Schema.NullOr(Aud),
  categories: Schema.Array(MonthCategoryLine),
});
export type MonthAnalysis = typeof MonthAnalysis.Type;

export const RecurringCharge = Schema.Struct({
  payee: Schema.String,
  cadenceDays: Schema.Int,
  occurrences: Schema.Int,
  medianAmount: Aud,
  annualizedAmount: Aud,
  lastSeen: CalendarDate,
  priceChange: Schema.NullOr(Schema.Struct({ from: Aud, to: Aud, on: CalendarDate })),
});
export type RecurringCharge = typeof RecurringCharge.Type;

export const SpendingAnomaly = Schema.Struct({
  rule: Schema.Literals(["large_expense", "new_payee", "category_spike"]),
  month: Schema.String,
  subject: Schema.String,
  amount: Schema.NullOr(Aud),
  detail: Schema.String,
});
export type SpendingAnomaly = typeof SpendingAnomaly.Type;

export const SavingsSuggestion = Schema.Struct({
  kind: Schema.Literals(["steady_charge", "price_rise"]),
  payee: Schema.String,
  /** For a price rise, the rise annualised — never the charge's annual spend. */
  annualAmount: Aud,
  detail: Schema.String,
  transactionIds: Schema.Array(BankTransactionId),
  dataThrough: CalendarDate,
});
export type SavingsSuggestion = typeof SavingsSuggestion.Type;

export const MoneyAnalysis = Schema.Struct({
  /** Only months with any coverage appear; incomplete ones are flagged, never zeroed. */
  months: Schema.Array(MonthAnalysis),
  recurring: Schema.Array(RecurringCharge),
  anomalies: Schema.Array(SpendingAnomaly),
  suggestions: Schema.Array(SavingsSuggestion),
  /** Set when a required-account gap makes suggestions unavailable. */
  suggestionsUnavailable: Schema.NullOr(Schema.String),
  completeMonths: Schema.Array(Schema.String),
  dataThrough: Schema.NullOr(CalendarDate),
});
export type MoneyAnalysis = typeof MoneyAnalysis.Type;

export const getMoneyAnalysisRpc = RpcModule.make("getMoneyAnalysis", {
  success: MoneyAnalysis,
  error: ReadError,
});

export const TransferLeg = Schema.Struct({
  transactionId: BankTransactionId,
  accountId: BankAccountId,
  productLabel: Schema.String,
  postedDate: CalendarDate,
  amount: Aud,
  narrative: Schema.String,
});
export type TransferLeg = typeof TransferLeg.Type;

export const TransferMatchSummary = Schema.Struct({
  id: TransferMatchId,
  a: TransferLeg,
  b: TransferLeg,
  status: TransferMatchStatus,
  method: TransferMatchMethod,
  createdAt: Instant,
});
export type TransferMatchSummary = typeof TransferMatchSummary.Type;

/** A transaction with plausible counterparts awaiting the operator's decision. */
export const TransferCandidateGroup = Schema.Struct({
  transaction: TransferLeg,
  counterparts: Schema.Array(TransferLeg),
});
export type TransferCandidateGroup = typeof TransferCandidateGroup.Type;

export const getTransferMatchesRpc = RpcModule.make("getTransferMatches", {
  success: Schema.Struct({
    matches: Schema.Array(TransferMatchSummary),
    unresolved: Schema.Array(TransferCandidateGroup),
  }),
  error: ReadError,
});

export const decideTransferMatchRpc = RpcModule.make("decideTransferMatch", {
  payload: {
    requestId: RequestId,
    transactionA: BankTransactionId,
    transactionB: BankTransactionId,
    decision: Schema.Literals(["confirm", "dismiss"]),
  },
  success: TransferMatchSummary,
  error: MutationError,
});

export const previewBankImportRpc = RpcModule.make("previewBankImport", {
  payload: { source: BankImportSource },
  success: PreviewBankImportResult,
  error: MutationError,
});

export const confirmBankImportRpc = RpcModule.make("confirmBankImport", {
  payload: {
    source: BankImportSource,
    expectedBundleDigest: Sha256,
    expectedPreviewFingerprint: Sha256,
    resolutions: Schema.Array(AmbiguityResolution),
    requestId: RequestId,
  },
  success: ConfirmBankImportResult,
  error: MutationError,
});

export const getBankAccountsRpc = RpcModule.make("getBankAccounts", {
  success: Schema.Array(BankAccountSummary),
  error: ReadError,
});

export const configureBankAccountRpc = RpcModule.make("configureBankAccount", {
  payload: {
    requestId: RequestId,
    productLabel: Schema.String,
    accountType: BankAccountType,
    required: Schema.Boolean,
    openedOn: Schema.NullOr(CalendarDate),
    closedOn: Schema.NullOr(CalendarDate),
  },
  success: BankAccountSummary,
  error: MutationError,
});

export const getBankCoverageRpc = RpcModule.make("getBankCoverage", {
  success: BankCoverage,
  error: ReadError,
});

export const getImportHistoryRpc = RpcModule.make("getImportHistory", {
  success: Schema.Array(ImportHistoryEntry),
  error: ReadError,
});

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

export const ReviewQueueEntry = Schema.Struct({
  transactionId: BankTransactionId,
  accountId: BankAccountId,
  productLabel: Schema.String,
  postedDate: CalendarDate,
  amount: Aud,
  narrative: Schema.String,
  payee: Schema.String,
  /** A pending AI suggestion, when one exists; auto-apply stays off. */
  suggestion: Schema.NullOr(
    Schema.Struct({
      categoryId: CategoryId,
      categoryName: Schema.String,
      rationale: Schema.String,
    }),
  ),
});
export type ReviewQueueEntry = typeof ReviewQueueEntry.Type;

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

export const getReviewQueueRpc = RpcModule.make("getReviewQueue", {
  success: Schema.Array(ReviewQueueEntry),
  error: ReadError,
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

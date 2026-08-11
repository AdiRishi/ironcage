import { Schema } from "effect";

import { FeedEventId } from "../feed/event";
import { CalendarDate } from "../values/calendar";
import { Money } from "../values/decimal";
import { Sha256 } from "../values/digest";
import { uuidV7 } from "../values/uuid";
import { BankAccount, BankAccountId, BankAccountProfileId } from "./account";

export const BankImportId = uuidV7("BankImportId");
export type BankImportId = typeof BankImportId.Type;

export const BankTransactionId = uuidV7("BankTransactionId");
export type BankTransactionId = typeof BankTransactionId.Type;

export const BankSourceFileId = uuidV7("BankSourceFileId");
export type BankSourceFileId = typeof BankSourceFileId.Type;

export const BankObservationId = uuidV7("BankObservationId");
export type BankObservationId = typeof BankObservationId.Type;

export const BankBalanceObservationId = uuidV7("BankBalanceObservationId");
export type BankBalanceObservationId = typeof BankBalanceObservationId.Type;

export const BankCoverageSegmentId = uuidV7("BankCoverageSegmentId");
export type BankCoverageSegmentId = typeof BankCoverageSegmentId.Type;

export const BankMonthCoverageObservationId = uuidV7("BankMonthCoverageObservationId");
export type BankMonthCoverageObservationId = typeof BankMonthCoverageObservationId.Type;

export const RequestId = uuidV7("RequestId");
export type RequestId = typeof RequestId.Type;

export const AmbiguityId = Sha256.pipe(Schema.brand("AmbiguityId"));
export type AmbiguityId = typeof AmbiguityId.Type;

export const UploadedBytes = Schema.Struct({
  name: Schema.String.check(Schema.isMinLength(1)),
  mediaType: Schema.String.check(Schema.isMinLength(1)),
  bytes: Schema.Uint8ArrayFromBase64,
});
export type UploadedBytes = typeof UploadedBytes.Type;

export const StructuredBankImportSource = Schema.Struct({
  kind: Schema.Literal("commbank_structured"),
  accountId: BankAccountId,
  csv: UploadedBytes,
  ofx: UploadedBytes,
});
export type StructuredBankImportSource = typeof StructuredBankImportSource.Type;

export const StatementBankImportSource = Schema.Struct({
  kind: Schema.Literal("commbank_statement"),
  accountId: BankAccountId,
  pdf: UploadedBytes,
});
export type StatementBankImportSource = typeof StatementBankImportSource.Type;

export const BankImportSource = Schema.Union([
  StructuredBankImportSource,
  StatementBankImportSource,
]);
export type BankImportSource = typeof BankImportSource.Type;

export const BankImportFileDigest = Schema.Struct({
  role: Schema.Literals(["csv", "ofx", "pdf"]),
  digest: Sha256,
});
export type BankImportFileDigest = typeof BankImportFileDigest.Type;

export const ImportWarning = Schema.Struct({
  reason: Schema.Literal("narrative_changed"),
  detail: Schema.String,
});
export type ImportWarning = typeof ImportWarning.Type;

export const ImportRowVerdict = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("New"),
    sourceOrdinal: Schema.Int,
    postedDate: CalendarDate,
    amount: Money,
    narrative: Schema.String,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Duplicate"),
    sourceOrdinal: Schema.Int,
    postedDate: CalendarDate,
    amount: Money,
    narrative: Schema.String,
    transactionId: BankTransactionId,
    matchTier: Schema.Literals(["bank_identifier", "row_balance", "content_occurrence"]),
  }),
  Schema.Struct({
    _tag: Schema.Literal("Ambiguous"),
    id: AmbiguityId,
    sourceOrdinal: Schema.Int,
    postedDate: CalendarDate,
    amount: Money,
    narrative: Schema.String,
    candidateTransactionIds: Schema.Array(BankTransactionId),
  }),
]);
export type ImportRowVerdict = typeof ImportRowVerdict.Type;

export const CoverageGap = Schema.Struct({
  accountId: BankAccountId,
  start: CalendarDate,
  end: CalendarDate,
});
export type CoverageGap = typeof CoverageGap.Type;

export const CoverageEffect = Schema.Struct({
  added: Schema.Array(Schema.Struct({ start: CalendarDate, end: CalendarDate })),
  retainedOverlap: Schema.Array(Schema.Struct({ start: CalendarDate, end: CalendarDate })),
  gapsRemaining: Schema.Array(CoverageGap),
});
export type CoverageEffect = typeof CoverageEffect.Type;

export const BankImportPreview = Schema.Struct({
  account: BankAccount,
  detectedProfile: BankAccountProfileId,
  sourceProfile: Schema.Literal("cba-netbank-paired-v1"),
  window: Schema.Struct({ start: CalendarDate, end: CalendarDate }),
  fileDigests: Schema.Array(BankImportFileDigest),
  bundleDigest: Sha256,
  previewFingerprint: Sha256,
  logicalTransactionCount: Schema.Int,
  observationCount: Schema.Int,
  verdicts: Schema.Array(ImportRowVerdict),
  reconciliation: Schema.Struct({
    balance: Schema.Literals(["matched", "outside_covered_window", "unavailable"]),
    ledgerBalance: Money,
  }),
  coverage: CoverageEffect,
  warnings: Schema.Array(ImportWarning),
  categoryReviewCount: Schema.Int,
});
export type BankImportPreview = typeof BankImportPreview.Type;

export const AmbiguityResolution = Schema.Struct({
  ambiguityId: AmbiguityId,
  decision: Schema.Union([
    Schema.Struct({ _tag: Schema.Literal("New") }),
    Schema.Struct({ _tag: Schema.Literal("Existing"), transactionId: BankTransactionId }),
  ]),
});
export type AmbiguityResolution = typeof AmbiguityResolution.Type;

export const ConfirmedBankImport = Schema.Struct({
  importId: BankImportId,
  accountId: BankAccountId,
  bundleDigest: Sha256,
  sourceWindow: Schema.Struct({ start: CalendarDate, end: CalendarDate }),
  sourceTransactions: Schema.Int,
  observations: Schema.Int,
  newTransactions: Schema.Int,
  duplicates: Schema.Int,
  resolvedAmbiguities: Schema.Int,
  coverage: CoverageEffect,
  feedEventId: FeedEventId,
  confirmedAt: Schema.DateTimeUtcFromString,
});
export type ConfirmedBankImport = typeof ConfirmedBankImport.Type;

export const BankImportHistoryItem = Schema.Struct({
  importId: BankImportId,
  accountId: BankAccountId,
  profile: Schema.String,
  bundleDigest: Sha256,
  window: Schema.Struct({ start: CalendarDate, end: CalendarDate }),
  sourceTransactions: Schema.Int,
  observations: Schema.Int,
  newTransactions: Schema.Int,
  duplicates: Schema.Int,
  resolvedAmbiguities: Schema.Int,
  confirmedAt: Schema.DateTimeUtcFromString,
});
export type BankImportHistoryItem = typeof BankImportHistoryItem.Type;

export const ArchivedBankStatement = Schema.Struct({
  id: BankImportId,
  accountId: BankAccountId,
  digest: Sha256,
  r2Key: Schema.String,
  archivedAt: Schema.DateTimeUtcFromString,
});
export type ArchivedBankStatement = typeof ArchivedBankStatement.Type;

import {
  BankAccountId,
  BankAccountType,
  BankTransactionId,
  CalendarDate,
  CategorizationRuleId,
  CategoryId,
  CategoryKind,
  RequestId,
  Sha256,
} from "@ironcage/domain";
import { Schema } from "effect";

import {
  AmbiguityResolution,
  BankAccountSummary,
  BankStatementArchive,
  CategorizeResult,
  CategorySummary,
  ConfirmBankImportResult,
  PreviewBankImportResult,
  RuleInput,
  RuleSummary,
  SplitInput,
  TransferMatchSummary,
} from "./money";

export const UploadPayload = Schema.Struct({
  displayName: Schema.String,
  base64: Schema.String,
});
export type UploadPayload = typeof UploadPayload.Type;

export const ImportSourcePayload = Schema.Struct({
  kind: Schema.Literal("commbank_structured"),
  accountId: BankAccountId,
  csv: UploadPayload,
  ofx: UploadPayload,
});
export type ImportSourcePayload = typeof ImportSourcePayload.Type;

export const ArchiveBankStatementPayload = Schema.Struct({
  requestId: RequestId,
  accountId: BankAccountId,
  pdf: UploadPayload,
});

export const PreviewPayload = Schema.Struct({ source: ImportSourcePayload });

export const ConfirmPayload = Schema.Struct({
  source: ImportSourcePayload,
  expectedBundleDigest: Sha256,
  expectedPreviewFingerprint: Sha256,
  resolutions: Schema.Array(AmbiguityResolution),
  requestId: RequestId,
});

export const CategorizePayload = Schema.Struct({
  requestId: RequestId,
  changes: Schema.Array(
    Schema.Struct({
      transactionId: BankTransactionId,
      splits: Schema.Array(SplitInput),
    }),
  ),
  createRules: Schema.Array(RuleInput),
});

export const DecideTransferPayload = Schema.Struct({
  requestId: RequestId,
  transactionA: BankTransactionId,
  transactionB: BankTransactionId,
  decision: Schema.Literals(["confirm", "dismiss"]),
});

export const CreateCategoryPayload = Schema.Struct({
  requestId: RequestId,
  name: Schema.String,
  kind: CategoryKind,
});

export const EditCategoryPayload = Schema.Struct({
  requestId: RequestId,
  categoryId: CategoryId,
  name: Schema.NullOr(Schema.String),
  archived: Schema.NullOr(Schema.Boolean),
});

export const ConfigureAccountPayload = Schema.Struct({
  requestId: RequestId,
  productLabel: Schema.String,
  accountType: BankAccountType,
  required: Schema.Boolean,
  openedOn: Schema.NullOr(CalendarDate),
  closedOn: Schema.NullOr(CalendarDate),
});

export const EditRulePayload = Schema.Struct({
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
});

export const MoneyMutationSuccess = {
  account: BankAccountSummary,
  archiveStatement: BankStatementArchive,
  category: CategorySummary,
  categorize: CategorizeResult,
  confirm: ConfirmBankImportResult,
  preview: PreviewBankImportResult,
  rule: RuleSummary,
  transfer: TransferMatchSummary,
} as const;

import {
  BankAccountSummary,
  CategorizePayload,
  CategorizeResult,
  CategorySummary,
  ConfirmBankImportResult,
  CreateCategoryPayload,
  DecideTransferPayload,
  EditCategoryPayload,
  EditRulePayload,
  Outcome,
  PreviewBankImportResult,
  RetryCategorizationPayload,
  RetryCategorizationResult,
  RuleSummary,
  TransferMatchSummary,
} from "@ironcage/contracts/schema";
import { Schema } from "effect";

export const decodePreviewOutcome = Schema.decodeUnknownSync(Outcome(PreviewBankImportResult));
export const decodeConfirmOutcome = Schema.decodeUnknownSync(Outcome(ConfirmBankImportResult));
export const decodeCategorizeOutcome = Schema.decodeUnknownSync(Outcome(CategorizeResult));
export const decodeRetryCategorizationOutcome = Schema.decodeUnknownSync(
  Outcome(RetryCategorizationResult),
);
export const decodeTransferOutcome = Schema.decodeUnknownSync(Outcome(TransferMatchSummary));
export const decodeCategoryOutcome = Schema.decodeUnknownSync(Outcome(CategorySummary));
export const decodeAccountOutcome = Schema.decodeUnknownSync(Outcome(BankAccountSummary));
export const decodeRuleOutcome = Schema.decodeUnknownSync(Outcome(RuleSummary));

export const encodeCategorizePayload = Schema.encodeSync(CategorizePayload);
export const encodeRetryCategorizationPayload = Schema.encodeSync(RetryCategorizationPayload);
export const encodeDecideTransferPayload = Schema.encodeSync(DecideTransferPayload);
export const encodeCreateCategoryPayload = Schema.encodeSync(CreateCategoryPayload);
export const encodeEditCategoryPayload = Schema.encodeSync(EditCategoryPayload);
export const encodeEditRulePayload = Schema.encodeSync(EditRulePayload);

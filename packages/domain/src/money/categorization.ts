import { Schema } from "effect";

import { CalendarDate } from "../values/calendar";
import { Money } from "../values/decimal";
import { uuidV7 } from "../values/uuid";
import { BankAccountId } from "./account";
import { BankTransactionId, RequestId } from "./import";

export const CategoryId = uuidV7("CategoryId");
export type CategoryId = typeof CategoryId.Type;

export const uncategorizedCategoryId = Schema.decodeUnknownSync(CategoryId)(
  "018f0000-0000-7000-8000-000000000001",
);

export const CategorizationRuleId = uuidV7("CategorizationRuleId");
export type CategorizationRuleId = typeof CategorizationRuleId.Type;

export const CategorizationSuggestionId = uuidV7("CategorizationSuggestionId");
export type CategorizationSuggestionId = typeof CategorizationSuggestionId.Type;

export const TransferMatchId = uuidV7("TransferMatchId");
export type TransferMatchId = typeof TransferMatchId.Type;

export const TransactionClassificationId = uuidV7("TransactionClassificationId");
export type TransactionClassificationId = typeof TransactionClassificationId.Type;

export const TransactionSplitId = uuidV7("TransactionSplitId");
export type TransactionSplitId = typeof TransactionSplitId.Type;

export const CategoryKind = Schema.Literals(["expense", "income"]);
export type CategoryKind = typeof CategoryKind.Type;

export const Category = Schema.Struct({
  id: CategoryId,
  version: Schema.Int,
  name: Schema.String.check(Schema.isMinLength(1)),
  kind: CategoryKind,
  system: Schema.Boolean,
});
export type Category = typeof Category.Type;

export const CategorySplit = Schema.Struct({
  categoryId: CategoryId,
  amount: Money,
});
export type CategorySplit = typeof CategorySplit.Type;

export const CategorizationRulePredicate = Schema.Struct({
  accountIds: Schema.Array(BankAccountId),
  direction: Schema.Literals(["debit", "credit", "either"]),
  payeeEquals: Schema.NullOr(Schema.String.check(Schema.isMinLength(1))),
  narrativeIncludes: Schema.Array(Schema.String.check(Schema.isMinLength(1))),
  minimumAbsoluteAmount: Schema.NullOr(Money),
  maximumAbsoluteAmount: Schema.NullOr(Money),
});
export type CategorizationRulePredicate = typeof CategorizationRulePredicate.Type;

export const CategorizationRule = Schema.Struct({
  id: CategorizationRuleId,
  version: Schema.Int,
  name: Schema.String.check(Schema.isMinLength(1)),
  predicate: CategorizationRulePredicate,
  categoryId: CategoryId,
  effectiveFrom: CalendarDate,
  retiredAt: Schema.NullOr(Schema.DateTimeUtcFromString),
});
export type CategorizationRule = typeof CategorizationRule.Type;

export const CategorizationReviewItem = Schema.Struct({
  transactionId: BankTransactionId,
  accountId: BankAccountId,
  postedDate: CalendarDate,
  amount: Money,
  narrative: Schema.String,
  splits: Schema.Array(CategorySplit),
  suggestion: Schema.NullOr(
    Schema.Struct({
      id: CategorizationSuggestionId,
      splits: Schema.Array(CategorySplit),
      confidence: Schema.BigDecimalFromString,
      rationale: Schema.String,
      decisionRecordId: Schema.String.check(Schema.isUUID(7)),
    }),
  ),
});
export type CategorizationReviewItem = typeof CategorizationReviewItem.Type;

export const CategorizeTransaction = Schema.Struct({
  transactionId: BankTransactionId,
  splits: Schema.Array(CategorySplit).check(Schema.isMinLength(1)),
  acceptedSuggestionId: Schema.NullOr(CategorizationSuggestionId),
});
export type CategorizeTransaction = typeof CategorizeTransaction.Type;

export const CategorizeTransactions = Schema.Struct({
  assignments: Schema.Array(CategorizeTransaction).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(200),
  ),
  requestId: RequestId,
});
export type CategorizeTransactions = typeof CategorizeTransactions.Type;

export const TransferCandidate = Schema.Struct({
  id: TransferMatchId,
  debitTransactionId: BankTransactionId,
  creditTransactionId: BankTransactionId,
  amount: Money,
  debitDate: CalendarDate,
  creditDate: CalendarDate,
  method: Schema.Literals(["unique", "reference", "amount_date", "manual"]),
  status: Schema.Literals(["proposed", "confirmed", "rejected"]),
});
export type TransferCandidate = typeof TransferCandidate.Type;

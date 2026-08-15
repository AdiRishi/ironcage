import { Schema } from "effect";

import { BankTransactionId, CategoryId } from "../money/ids";
import { Aud } from "../values/decimal";

export const CategorizationBatchItem = Schema.Struct({
  transactionId: BankTransactionId,
  payee: Schema.String,
  narrative: Schema.String,
  amount: Aud,
  accountLabel: Schema.String,
});
export type CategorizationBatchItem = typeof CategorizationBatchItem.Type;

export const CategorizationCategory = Schema.Struct({
  id: CategoryId,
  name: Schema.String,
  kind: Schema.Literals(["expense", "income"]),
});
export type CategorizationCategory = typeof CategorizationCategory.Type;

export const CategorizationOutput = Schema.Struct({
  suggestions: Schema.Array(
    Schema.Struct({
      transactionId: BankTransactionId,
      categoryId: CategoryId,
      rationale: Schema.String,
    }),
  ),
});
export type CategorizationOutput = typeof CategorizationOutput.Type;

export const categorizationCapability = {
  name: "money.categorization",
  consumes: "an immutable batch of normalized bank transactions and offered categories",
  output: CategorizationOutput,
  consumer: "core categorization ledger",
  trigger: "confirmed bank import",
  safeDefault: "leave every transaction uncategorized",
  noAiIdentity: "uncategorized",
  materialChange: "a category correction changes or creates a forward-only visible rule",
  demotion: "disable dispatch while retaining rules and uncategorized review",
  configVersion: 2,
  batchSize: 200,
} as const;

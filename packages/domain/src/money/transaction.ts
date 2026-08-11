import { Schema } from "effect";

import { CalendarDate } from "../values/calendar";
import { Money } from "../values/decimal";
import { BankAccountId } from "./account";
import { CategorySplit } from "./categorization";
import { BankImportId, BankObservationId, BankSourceFileId, BankTransactionId } from "./import";

export const BankTransactionRecord = Schema.Struct({
  id: BankTransactionId,
  accountId: BankAccountId,
  postedDate: CalendarDate,
  amount: Money,
  preferredNarrative: Schema.String,
  ownedTransfer: Schema.Boolean,
  splits: Schema.Array(CategorySplit),
  observations: Schema.Array(
    Schema.Struct({
      id: BankObservationId,
      sourceFileId: BankSourceFileId,
      importId: BankImportId,
      sourceRole: Schema.Literals(["csv", "ofx", "pdf", "extracted_markdown"]),
      originalName: Schema.String,
      sourceKind: Schema.Literals(["csv", "ofx", "statement"]),
      sourceOrdinal: Schema.Int,
      rawFields: Schema.Record(Schema.String, Schema.String),
      parsedFields: Schema.Record(Schema.String, Schema.String),
      matchTier: Schema.Literals([
        "new",
        "bank_identifier",
        "row_balance",
        "content_occurrence",
        "manual",
      ]),
    }),
  ),
});
export type BankTransactionRecord = typeof BankTransactionRecord.Type;

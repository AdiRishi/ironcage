import { Schema } from "effect";

/**
 * Why a whole bundle refused to affect the record. A block is a validation
 * verdict on the source evidence, not an error in the machinery: the response
 * carries it as data so the operator can fix the export and retry.
 */
export const ImportBlockCode = Schema.Literals([
  "CsvGrammar",
  "OfxGrammar",
  "CurrencyUnsupported",
  "AccountMismatch",
  "WindowOutsideAccountLifetime",
  "RowOrder",
  "PairingMismatch",
  "ExportTruncated",
  "BalanceChainFailed",
  "LedgerMismatch",
  "SourceIdentifierConflict",
  "StatementGrammar",
  "StatementReconciliation",
  "StatementOverlapMismatch",
  "StatementNeedsManualExtraction",
]);
export type ImportBlockCode = typeof ImportBlockCode.Type;

export const ImportBlock = Schema.Struct({
  code: ImportBlockCode,
  detail: Schema.String,
});
export type ImportBlock = typeof ImportBlock.Type;

import type { ImportBlockCode } from "@ironcage/domain";

interface BlockGuidance {
  readonly title: string;
  readonly hint: string;
}

/**
 * Operator-facing copy for each way a bundle can refuse to affect the record.
 * A block is a verdict on the evidence, not a system fault, so every entry
 * says what the evidence failed to prove and what export fixes it. The
 * server's own `detail` renders alongside for the specifics.
 */
export const blockGuidance = {
  CsvGrammar: {
    title: "The CSV didn't parse as a NetBank export",
    hint: "Re-export it from NetBank and upload it unopened — editors change line endings and quoting.",
  },
  OfxGrammar: {
    title: "The OFX didn't parse as a NetBank export",
    hint: "Re-export it from NetBank and upload it unopened.",
  },
  CurrencyUnsupported: {
    title: "This export isn't in AUD",
    hint: "Money reads the AUD bank record only.",
  },
  AccountMismatch: {
    title: "These files belong to a different account",
    hint: "The file's identity decides, not the selection. Pick the account the files were exported from.",
  },
  WindowOutsideAccountLifetime: {
    title: "The window falls outside this account's life",
    hint: "Adjust the account's open and close dates, or export a window the account was open for.",
  },
  RowOrder: {
    title: "Rows aren't newest first",
    hint: "Export directly from NetBank without sorting or editing the file.",
  },
  PairingMismatch: {
    title: "The CSV and OFX describe different rows",
    hint: "Export both files for the same account and the same date window, in one sitting.",
  },
  ExportTruncated: {
    title: "NetBank capped this export at 600 rows",
    hint: "A capped file can't prove complete coverage. Split the window and export smaller ranges.",
  },
  BalanceChainFailed: {
    title: "The running balances don't chain",
    hint: "A row is missing or altered. Re-export the window and upload the fresh files.",
  },
  LedgerMismatch: {
    title: "The newest balance disagrees with the file's ledger balance",
    hint: "Export both files together so they describe the same moment.",
  },
  SourceIdentifierConflict: {
    title: "A bank identifier contradicts the record",
    hint: "The same identifier already exists with a different date or amount. Nothing was written; this needs a closer look.",
  },
  StatementGrammar: {
    title: "The statement didn't parse under its layout profile",
    hint: "This PDF does not match the supported CommBank offset statement layout. Nothing was written.",
  },
  StatementReconciliation: {
    title: "The statement doesn't reconcile from opening to closing",
    hint: "Its rows and totals disagree with its own balances. Re-download it and try again.",
  },
  StatementOverlapMismatch: {
    title: "The statement disagrees with structured history it overlaps",
    hint: "Where CSV/OFX coverage is complete, the statement must align row for row. Nothing was written.",
  },
  StatementNeedsManualExtraction: {
    title: "No text could be extracted from this PDF",
    hint: "The statement may be scanned or damaged. Nothing was written.",
  },
} satisfies Record<ImportBlockCode, BlockGuidance>;

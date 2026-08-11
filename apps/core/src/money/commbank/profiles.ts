import { Schema } from "effect";

/**
 * Every import is interpreted by one named and versioned source profile, and
 * one account profile inside it. The profile is what makes a decoder able to
 * fail closed: it declares the file grammar before any bytes are read, so an
 * unexpected shape is a rejection rather than a surprise the parser absorbs.
 *
 * The four profiles below are the observed NetBank exports recorded in
 * `docs/technical/examples/commbank-exports.md`. A fifth account, and any
 * statement layout, arrives with its own redacted fixture first.
 */
export const commBankPairedProfileVersion = "cba-netbank-paired-v1";

/** The account types Money recognizes, independent of the bank's product name. */
export const BankAccountType = Schema.Literals(["deposit", "credit_card", "credit_line"]);
export type BankAccountType = typeof BankAccountType.Type;

export const CommBankProfileId = Schema.Literals([
  "spending-offset",
  "savings-offset",
  "mastercard",
  "home-loan",
]);
export type CommBankProfileId = typeof CommBankProfileId.Type;

export interface CommBankAccountProfile {
  readonly id: CommBankProfileId;
  /** The label the operator sees, and the only account name the interface stores. */
  readonly label: string;
  readonly accountType: BankAccountType;
  /**
   * Whether the CSV's fourth cell carries a running balance. `forbidden` is the
   * Mastercard shape, whose empty cell is the reason a Markdown table can never
   * be the CSV contract.
   */
  readonly rowBalance: "required" | "forbidden";
  /**
   * Whether the OFX `FITID` is a usable transaction identifier. `stable` means
   * overlap fixtures proved it identifies the same movement across exports;
   * `absent` means the observed exports emit an empty element. Deduplication
   * reads this; the decoder only reports what the file contained.
   */
  readonly identifier: "stable" | "absent";
  /** Which OFX message set the file must use. */
  readonly messageSet: "bank" | "credit_card";
  /** The exact statement aggregate spelling emitted for this account profile. */
  readonly statementAggregate: {
    readonly opening: "STMTRS" | "CCSTMTRS";
    readonly closing: "STMTRS" | "CCSTMTRS";
  };
}

export const commBankAccountProfiles = {
  "spending-offset": {
    id: "spending-offset",
    label: "Spending offset",
    accountType: "deposit",
    rowBalance: "required",
    identifier: "stable",
    messageSet: "bank",
    statementAggregate: { opening: "STMTRS", closing: "STMTRS" },
  },
  "savings-offset": {
    id: "savings-offset",
    label: "Savings offset",
    accountType: "deposit",
    rowBalance: "required",
    identifier: "stable",
    messageSet: "bank",
    statementAggregate: { opening: "STMTRS", closing: "STMTRS" },
  },
  mastercard: {
    id: "mastercard",
    label: "Mastercard",
    accountType: "credit_card",
    rowBalance: "forbidden",
    identifier: "absent",
    messageSet: "credit_card",
    statementAggregate: { opening: "CCSTMTRS", closing: "CCSTMTRS" },
  },
  "home-loan": {
    id: "home-loan",
    label: "Home loan",
    accountType: "credit_line",
    // The observed home-loan balance is negative, and the decoder deliberately
    // does not enforce that sign. A repaid loan reaching zero is not a parser
    // failure, and the balance chain in the pairing step is what actually
    // proves the column.
    rowBalance: "required",
    identifier: "absent",
    messageSet: "bank",
    // NetBank emits this mismatched pair in the observed home-loan export.
    // Keeping it in the profile prevents the generic SGML parser from becoming
    // permissive while still accepting the bank's actual file.
    statementAggregate: { opening: "CCSTMTRS", closing: "STMTRS" },
  },
} as const satisfies Record<CommBankProfileId, CommBankAccountProfile>;

import { Schema } from "effect";

export const commBankPairedProfileVersion = "cba-netbank-paired-v1";

export const CommBankProfileId = Schema.Literals([
  "spending-offset",
  "savings-offset",
  "mastercard",
  "home-loan",
]);
export type CommBankProfileId = typeof CommBankProfileId.Type;

interface CommBankProfileShape {
  readonly label: string;
  readonly accountType: "deposit" | "credit_card" | "credit_line";
  readonly rowBalance: "required" | "forbidden";
  readonly identifier: "stable" | "absent";
  readonly messageSet: "bank" | "credit_card";
  readonly statementAggregate: {
    readonly opening: "STMTRS" | "CCSTMTRS";
    readonly closing: "STMTRS" | "CCSTMTRS";
  };
}

export const commBankAccountProfiles = {
  "spending-offset": {
    label: "Spending offset",
    accountType: "deposit",
    rowBalance: "required",
    identifier: "stable",
    messageSet: "bank",
    statementAggregate: { opening: "STMTRS", closing: "STMTRS" },
  },
  "savings-offset": {
    label: "Savings offset",
    accountType: "deposit",
    rowBalance: "required",
    identifier: "stable",
    messageSet: "bank",
    statementAggregate: { opening: "STMTRS", closing: "STMTRS" },
  },
  mastercard: {
    label: "Mastercard",
    accountType: "credit_card",
    rowBalance: "forbidden",
    identifier: "absent",
    messageSet: "credit_card",
    statementAggregate: { opening: "CCSTMTRS", closing: "CCSTMTRS" },
  },
  "home-loan": {
    label: "Home loan",
    accountType: "credit_line",
    rowBalance: "required",
    identifier: "absent",
    messageSet: "bank",
    statementAggregate: { opening: "CCSTMTRS", closing: "STMTRS" },
  },
} as const satisfies Record<CommBankProfileId, CommBankProfileShape>;

export type CommBankAccountProfile =
  (typeof commBankAccountProfiles)[keyof typeof commBankAccountProfiles];

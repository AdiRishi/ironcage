import { Schema } from "effect";

export const commBankPairedProfileId = "cba-netbank-paired-v1";

export const CommBankAccountProfileId = Schema.Literals([
  "spending-offset",
  "savings-offset",
  "mastercard",
  "home-loan",
]);
export type CommBankAccountProfileId = typeof CommBankAccountProfileId.Type;

type CommBankProfileShape = { readonly label: string } & (
  | {
      readonly accountType: "deposit";
      readonly rowBalance: "required";
      readonly identifier: "stable";
      readonly messageSet: "bank";
      readonly statementAggregate: { readonly opening: "STMTRS"; readonly closing: "STMTRS" };
    }
  | {
      readonly accountType: "credit_card";
      readonly rowBalance: "forbidden";
      readonly identifier: "absent";
      readonly messageSet: "credit_card";
      readonly statementAggregate: {
        readonly opening: "CCSTMTRS";
        readonly closing: "CCSTMTRS";
      };
    }
  | {
      readonly accountType: "credit_line";
      readonly rowBalance: "required";
      readonly identifier: "absent";
      readonly messageSet: "bank";
      readonly statementAggregate: { readonly opening: "CCSTMTRS"; readonly closing: "STMTRS" };
    }
);

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
} as const satisfies Record<CommBankAccountProfileId, CommBankProfileShape>;

export type CommBankAccountProfile =
  (typeof commBankAccountProfiles)[keyof typeof commBankAccountProfiles];

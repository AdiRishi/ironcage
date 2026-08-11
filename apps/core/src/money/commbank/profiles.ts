import { Schema } from "effect";

export const commBankPairedProfileId = "cba-netbank-paired-v1";

export const CommBankAccountProfileId = Schema.Literals([
  "spending-offset",
  "savings-offset",
  "mastercard",
  "home-loan",
]);
export type CommBankAccountProfileId = typeof CommBankAccountProfileId.Type;

/**
 * A profile declares every rule its files are read under, so the decoder asks
 * the profile rather than re-deriving policy from the account type.
 * `ofxAccountType` is the `ACCTTYPE` the bank writes inside `BANKACCTFROM`; a
 * credit-card file identifies itself through `CCACCTFROM`, which carries none.
 */
type CommBankProfileShape = { readonly label: string } & (
  | {
      readonly accountType: "deposit";
      readonly rowBalance: "required";
      readonly identifier: "stable";
      readonly messageSet: "bank";
      readonly ofxAccountType: "SAVINGS";
      readonly narrative: "free_text";
      readonly statementAggregate: { readonly opening: "STMTRS"; readonly closing: "STMTRS" };
    }
  | {
      readonly accountType: "credit_card";
      readonly rowBalance: "forbidden";
      readonly identifier: "absent";
      readonly messageSet: "credit_card";
      readonly ofxAccountType: null;
      readonly narrative: "card_fixed_width";
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
      readonly ofxAccountType: "CREDITLINE";
      readonly narrative: "free_text";
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
    ofxAccountType: "SAVINGS",
    narrative: "free_text",
    statementAggregate: { opening: "STMTRS", closing: "STMTRS" },
  },
  "savings-offset": {
    label: "Savings offset",
    accountType: "deposit",
    rowBalance: "required",
    identifier: "stable",
    messageSet: "bank",
    ofxAccountType: "SAVINGS",
    narrative: "free_text",
    statementAggregate: { opening: "STMTRS", closing: "STMTRS" },
  },
  mastercard: {
    label: "Mastercard",
    accountType: "credit_card",
    rowBalance: "forbidden",
    identifier: "absent",
    messageSet: "credit_card",
    ofxAccountType: null,
    narrative: "card_fixed_width",
    statementAggregate: { opening: "CCSTMTRS", closing: "CCSTMTRS" },
  },
  "home-loan": {
    label: "Home loan",
    accountType: "credit_line",
    rowBalance: "required",
    identifier: "absent",
    messageSet: "bank",
    ofxAccountType: "CREDITLINE",
    narrative: "free_text",
    statementAggregate: { opening: "CCSTMTRS", closing: "STMTRS" },
  },
} as const satisfies Record<CommBankAccountProfileId, CommBankProfileShape>;

export type CommBankAccountProfile =
  (typeof commBankAccountProfiles)[keyof typeof commBankAccountProfiles];

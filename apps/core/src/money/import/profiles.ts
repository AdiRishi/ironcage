import type { BankAccountType } from "@ironcage/domain";

import type { CsvBalancePolicy } from "./csv";
import type { OfxVariant } from "./ofx";

/**
 * What `cba-netbank-paired-v1` demands from each account type. Every rule here
 * is fixture-proven; changing one means a new profile version with new
 * fixtures, not an edit.
 */
export interface PairedAccountRules {
  readonly csvBalances: CsvBalancePolicy;
  readonly ofxVariant: OfxVariant;
  /** The OFX `ACCTTYPE` the profile expects, or null where none is emitted. */
  readonly acctType: string | null;
  /**
   * `verified` marks the fixture-proven stable identifier gate for tier 1;
   * `empty` marks the profiles whose observed FITID is always blank.
   */
  readonly fitids: "verified" | "empty";
  readonly payeeGrammar: "card" | "deposit";
}

export const pairedRules: Readonly<Record<BankAccountType, PairedAccountRules>> = {
  deposit: {
    csvBalances: "required",
    ofxVariant: "deposit",
    acctType: "SAVINGS",
    fitids: "verified",
    payeeGrammar: "deposit",
  },
  credit_card: {
    csvBalances: "forbidden",
    ofxVariant: "credit_card",
    acctType: null,
    fitids: "empty",
    payeeGrammar: "card",
  },
  credit_line: {
    csvBalances: "required",
    ofxVariant: "home_loan",
    acctType: "CREDITLINE",
    fitids: "empty",
    payeeGrammar: "deposit",
  },
};

export const pairedProfileName = "cba-netbank-paired-v1";

/**
 * NetBank returned exactly 600 rows and omitted older history in a broad
 * search; a 600-row export cannot prove its window was complete.
 */
export const truncationRowCount = 600;

/**
 * The canonical identity string behind the account HMAC: bank, product type,
 * and the bank-supplied identifiers exactly as the OFX declared them.
 */
export const accountIdentityInput = (
  accountType: BankAccountType,
  identity: { readonly bankId: string | null; readonly acctId: string },
): string => `cba|${accountType}|${identity.bankId ?? ""}|${identity.acctId}`;

export const hmacSha256Hex = async (key: string, input: string): Promise<string> => {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(input));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
};

import { describe, expect, test } from "vitest";

import { commBankPayee } from "../../../src/money/commbank/payee";
import mastercardCsv from "../../fixtures/money/commbank/mastercard/mastercard-a.csv?bytes";
import spendingCsv from "../../fixtures/money/commbank/spending-offset/spending-offset-a.csv?bytes";

/** `DD/MM/YYYY,"amount","narrative","balance"`, so the narrative is the middle quoted cell. */
const narratives = (bytes: Uint8Array) =>
  new TextDecoder("windows-1252")
    .decode(bytes)
    .split("\r\n")
    .filter((line) => line !== "")
    .map((line) => line.split('","')[1]!);

describe("CommBank payee derivation", () => {
  test("collapses a deposit narrative's per-transaction detail into one payee", () => {
    const payee = (narrative: string) => commBankPayee("spending-offset", narrative);

    expect(payee("Spotify P4530B94C9 Sydney AU AUS Card xx0000 Value Date: 01/08/2026")).toBe(
      "Spotify Sydney AU AUS",
    );
    expect(payee("Spotify P441EF6205 Sydney AU AUS Card xx0000 Value Date: 01/07/2026")).toBe(
      "Spotify Sydney AU AUS",
    );
    expect(payee("Direct Debit 373578 AGL RETAIL ENERG 190916637977")).toBe(
      "Direct Debit AGL RETAIL ENERG",
    );
    expect(payee("International Transaction Fee Value Date: 18/07/2026")).toBe(
      "International Transaction Fee",
    );
    expect(
      payee("ZOOM.COM 888-799-9666 SAN JOSE CA USA Card xx0000 USD 18.69 Value Date: 19/07/2026"),
    ).toBe("ZOOM.COM SAN JOSE CA USA");
  });

  test("keeps identifiers that name the payee rather than the transaction", () => {
    const payee = (narrative: string) => commBankPayee("spending-offset", narrative);

    expect(payee("1PASSWORD TORONTO ON CAN Card xx0000 USD 16.47 Value Date: 14/07/2026")).toBe(
      "1PASSWORD TORONTO ON CAN",
    );
    expect(payee("Transfer to xx0001 NetBank")).toBe("Transfer to xx0001 NetBank");
    expect(commBankPayee("mastercard", "WOOLWORTHS      1106     PARRAMATTA  NS")).toBe(
      "WOOLWORTHS 1106",
    );
  });

  test("reads the card narrative's fixed-width merchant field", () => {
    const payee = (narrative: string) => commBankPayee("mastercard", narrative);

    expect(payee("UBER *EATS HELP.UBER.C   Sydney      AUS")).toBe("UBER *EATS HELP.UBER.C");
    expect(payee("Fanvue                   London UK   GBR ##0726          81.59 US DOLLAR")).toBe(
      "Fanvue",
    );
    expect(payee("AUTO PAYMENT - THANK YOU")).toBe("AUTO PAYMENT - THANK YOU");
  });

  test("gives every observed source narrative a payee that repeats across occurrences", () => {
    const cardPayees = narratives(mastercardCsv).map((narrative) =>
      commBankPayee("mastercard", narrative),
    );
    const depositPayees = narratives(spendingCsv).map((narrative) =>
      commBankPayee("spending-offset", narrative),
    );

    expect(cardPayees.every((payee) => payee.length > 0)).toBe(true);
    expect(depositPayees.every((payee) => payee.length > 0)).toBe(true);
    // The corpus is a real monthly export: repeated merchants must group, or
    // recurring-charge detection has nothing to detect.
    expect(new Set(cardPayees).size).toBeLessThan(new Set(narratives(mastercardCsv)).size);
    expect(new Set(depositPayees).size).toBeLessThan(new Set(narratives(spendingCsv)).size);
  });
});

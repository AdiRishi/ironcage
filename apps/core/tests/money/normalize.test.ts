import { describe, expect, test } from "vitest";

import {
  derivePayee,
  displayNarrative,
  narrativeFingerprint,
} from "../../src/money/import/normalize";

describe("narrative normalization", () => {
  test("fingerprint folds case and whitespace but keeps digits and punctuation", () => {
    expect(narrativeFingerprint("WOOLWORTHS  METRO   Card xx4321 Value Date: 25/01/2032")).toBe(
      "woolworths metro card xx4321 value date: 25/01/2032",
    );
  });

  test("display narrative applies NFKC without touching content", () => {
    expect(displayNarrative("CAFÉ  №42")).toBe("CAFÉ No42");
  });

  test("card payee is the 25-character merchant field without the city columns", () => {
    expect(derivePayee("FIXTURE MASTERCARD 0102  SYDNEY      NSW", "card")).toBe(
      "FIXTURE MASTERCARD 0102",
    );
  });

  test("deposit payee cuts card and value-date suffixes", () => {
    expect(derivePayee("WOOLWORTHS METRO Card xx4321 Value Date: 25/01/2032", "deposit")).toBe(
      "WOOLWORTHS METRO",
    );
  });

  test("six-digit reference tokens drop while shorter digits survive", () => {
    expect(derivePayee("Transfer To Somebody 987654321", "deposit")).toBe("Transfer To Somebody");
    expect(derivePayee("7-ELEVEN 2041", "deposit")).toBe("7-ELEVEN 2041");
  });

  test("a payee that reduces to nothing falls back to the narrative", () => {
    expect(derivePayee("123456789", "deposit")).toBe("123456789");
  });
});

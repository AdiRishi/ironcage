import { describe, expect, it } from "@effect/vitest";

import { aliasKey, describeCommBank } from "../../src/index.ts";

const deposit = (description: string, amountMinor = -1000n) =>
  describeCommBank({ description, amountMinor, accountKind: "deposit" });

describe("describeCommBank", () => {
  it("reads a debit card purchase with its card suffix", () => {
    const descriptor = deposit("WOOLWORTHS 1234 SYDNEY AU Card xx1234 Value Date: 02/09/2026");
    expect(descriptor).toMatchObject({
      channel: "card",
      counterpartyText: "WOOLWORTHS 1234 SYDNEY AU",
      aliasKey: "WOOLWORTHS SYDNEY",
      cardSuffix: "1234",
      foreign: null,
    });
  });

  it("keeps the foreign amount of an overseas card purchase", () => {
    expect(deposit("NETFLIX.COM Card xx1234 USD 15.99")).toMatchObject({
      channel: "card",
      counterpartyText: "NETFLIX.COM",
      foreign: { currency: "USD", amount: "15.99" },
    });
  });

  it("groups store numbers of one business under one alias key", () => {
    expect(deposit("WOOLWORTHS 5678 SYDNEY AU Card xx1234").aliasKey).toBe(
      deposit("WOOLWORTHS 1234 SYDNEY AU Card xx1234").aliasKey,
    );
  });

  it("reads a transfer to one of your accounts as an own-account suffix, not a counterparty", () => {
    expect(deposit("Transfer to xx5678 CommBank app Savings")).toMatchObject({
      channel: "transfer",
      counterpartyText: null,
      aliasKey: "ACCOUNT 5678",
      ownAccountSuffix: "5678",
      reference: "Savings",
    });
  });

  it("reads a transfer to a person as a counterparty with a reference", () => {
    expect(deposit("Transfer To Jane Smith NetBank Rent")).toMatchObject({
      channel: "transfer",
      counterpartyText: "Jane Smith",
      aliasKey: "JANE SMITH",
      reference: "Rent",
    });
  });

  it("separates the PayID from the payee", () => {
    expect(
      deposit("Transfer To Jane Smith PayID 0412345678 from CommBank app dinner"),
    ).toMatchObject({ counterpartyText: "Jane Smith", payId: "0412345678", reference: "dinner" });
  });

  it("reads an incoming transfer from a person", () => {
    expect(deposit("Fast Transfer From John Citizen dinner split", 4500n)).toMatchObject({
      channel: "transfer",
      counterpartyText: "John Citizen",
      reference: "dinner split",
    });
  });

  it("reads direct debits, direct credits, and salary without their references", () => {
    expect(deposit("Direct Debit 123456 ORIGIN ENERGY 0012345678")).toMatchObject({
      channel: "directDebit",
      counterpartyText: "ORIGIN ENERGY",
      reference: "0012345678",
    });
    expect(deposit("Direct Credit 654321 ATO ATO012345 1", 50000n)).toMatchObject({
      channel: "directCredit",
      counterpartyText: "ATO",
    });
    expect(deposit("Salary ACME PTY LTD HR123456", 500000n)).toMatchObject({
      channel: "salary",
      counterpartyText: "ACME PTY LTD",
      aliasKey: "ACME PTY LTD",
    });
    expect(deposit("Salary ACME PTY LTD Salary", 500000n).counterpartyText).toBe("ACME PTY LTD");
  });

  it("reads bank-generated rows with no counterparty", () => {
    expect(deposit("International Transaction Fee").channel).toBe("fee");
    expect(deposit("Credit Interest", 120n).channel).toBe("interest");
    expect(
      describeCommBank({
        description: "Interest charged",
        amountMinor: -280000n,
        accountKind: "loan",
      }).channel,
    ).toBe("interest");
    expect(
      describeCommBank({
        description: "Repayment/Payment",
        amountMinor: 390000n,
        accountKind: "loan",
      }).channel,
    ).toBe("loan");
    expect(deposit("Loan Repayment LN REPAY 123456789").channel).toBe("loan");
    expect(deposit("Wdl ATM CBA ATM SYDNEY 123456").channel).toBe("cash");
  });

  it("reads refunds and returns as card rows for the original counterparty", () => {
    expect(deposit("Refund Purchase MYER SYDNEY", 4000n)).toMatchObject({
      channel: "card",
      counterpartyText: "MYER SYDNEY",
    });
    expect(deposit("Return UNIQLO 12345 Card xx1234", 4000n)).toMatchObject({
      channel: "card",
      aliasKey: "UNIQLO",
    });
  });

  it("reads card account rows without a card marker as card purchases and payments", () => {
    const card = (description: string, amountMinor: bigint) =>
      describeCommBank({ description, amountMinor, accountKind: "card" });
    expect(card("SPOTIFY STOCKHOLM SE", -1299n)).toMatchObject({
      channel: "card",
      aliasKey: "SPOTIFY STOCKHOLM",
    });
    expect(card("Payment Received, Thank You", 100000n).channel).toBe("cardPayment");
  });

  it("keeps an unmarked deposit row as text for the counterparty", () => {
    expect(deposit("UBER *TRIP HELP.UBER.COM")).toMatchObject({
      channel: "other",
      aliasKey: "UBER TRIP HELP UBER COM",
    });
  });
});

describe("aliasKey", () => {
  it("drops punctuation, numbered tokens, and a trailing country code", () => {
    expect(aliasKey("SQ *BLUE BOTTLE 0412 SURRY HILLS AU")).toBe("SQ BLUE BOTTLE SURRY HILLS");
    expect(aliasKey("1234 5678")).toBeNull();
  });
});

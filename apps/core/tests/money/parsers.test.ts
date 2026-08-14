import { BigDecimal, Effect } from "effect";
import { describe, expect, test } from "vitest";

import type { BankImportBlocked } from "../../src/money/block";
import { parseBankCsv, type CsvBalancePolicy } from "../../src/money/csv";
import { parseBankOfx, type OfxVariant } from "../../src/money/ofx";
import homeLoanCsv from "../fixtures/money/commbank/home-loan/home-loan-a.csv?bytes";
import homeLoanOfx from "../fixtures/money/commbank/home-loan/home-loan-a.ofx?bytes";
import mastercardCsv from "../fixtures/money/commbank/mastercard/mastercard-a.csv?bytes";
import mastercardOfx from "../fixtures/money/commbank/mastercard/mastercard-a.ofx?bytes";
import savingsCsv from "../fixtures/money/commbank/savings-offset/savings-offset-a.csv?bytes";
import savingsOfx from "../fixtures/money/commbank/savings-offset/savings-offset-a.ofx?bytes";
import spendingACsv from "../fixtures/money/commbank/spending-offset/spending-offset-a.csv?bytes";
import spendingAOfx from "../fixtures/money/commbank/spending-offset/spending-offset-a.ofx?bytes";
import spendingBCsv from "../fixtures/money/commbank/spending-offset/spending-offset-b.csv?bytes";
import spendingBOfx from "../fixtures/money/commbank/spending-offset/spending-offset-b.ofx?bytes";
import spendingCCsv from "../fixtures/money/commbank/spending-offset/spending-offset-c.csv?bytes";
import spendingCOfx from "../fixtures/money/commbank/spending-offset/spending-offset-c.ofx?bytes";

const block = (effect: Effect.Effect<unknown, BankImportBlocked>): BankImportBlocked =>
  Effect.runSync(Effect.flip(effect));

const decimal = (value: string) => BigDecimal.fromStringUnsafe(value);

interface Fixture {
  readonly name: string;
  readonly csv: Uint8Array;
  readonly ofx: Uint8Array;
  readonly balances: CsvBalancePolicy;
  readonly variant: OfxVariant;
  readonly rows: number;
  readonly window: readonly [string, string];
  readonly fitids: "every-row" | "empty";
}

// Row counts, windows, and identifier presence come from the fixture
// manifest; a drift between corpus and parser fails here first.
const corpus: readonly Fixture[] = [
  {
    name: "spending-offset-a",
    csv: spendingACsv,
    ofx: spendingAOfx,
    balances: "required",
    variant: "deposit",
    rows: 40,
    window: ["2031-12-11", "2032-01-29"],
    fitids: "every-row",
  },
  {
    name: "spending-offset-b",
    csv: spendingBCsv,
    ofx: spendingBOfx,
    balances: "required",
    variant: "deposit",
    rows: 25,
    window: ["2031-12-22", "2032-01-21"],
    fitids: "every-row",
  },
  {
    name: "spending-offset-c",
    csv: spendingCCsv,
    ofx: spendingCOfx,
    balances: "required",
    variant: "deposit",
    rows: 23,
    window: ["2032-01-05", "2032-01-29"],
    fitids: "every-row",
  },
  {
    name: "savings-offset-a",
    csv: savingsCsv,
    ofx: savingsOfx,
    balances: "required",
    variant: "deposit",
    rows: 40,
    window: ["2030-05-26", "2031-09-16"],
    fitids: "every-row",
  },
  {
    name: "mastercard-a",
    csv: mastercardCsv,
    ofx: mastercardOfx,
    balances: "forbidden",
    variant: "credit_card",
    rows: 102,
    window: ["2031-12-22", "2032-01-21"],
    fitids: "empty",
  },
  {
    name: "home-loan-a",
    csv: homeLoanCsv,
    ofx: homeLoanOfx,
    balances: "required",
    variant: "home_loan",
    rows: 36,
    // The manifest's sourceWindow lists the row span; the coverage window is
    // the file's own DTSTART/DTEND — here a two-year request.
    window: ["2030-01-29", "2032-01-29"],
    fitids: "empty",
  },
];

describe("the fixture corpus parses under its profiles", () => {
  test.each(corpus)("$name", ({ csv, ofx, balances, variant, rows, window, fitids }) => {
    const parsedCsv = Effect.runSync(parseBankCsv(csv, balances));
    const parsedOfx = Effect.runSync(parseBankOfx(ofx, variant));

    expect(parsedCsv).toHaveLength(rows);
    expect(parsedOfx.transactions).toHaveLength(rows);
    expect(parsedOfx.currency).toBe("AUD");
    expect([parsedOfx.window.start, parsedOfx.window.end]).toEqual(window);
    expect(parsedOfx.account.acctId.length).toBeGreaterThan(0);

    for (const transaction of parsedOfx.transactions) {
      if (fitids === "empty") expect(transaction.fitid).toBe("");
      else expect(transaction.fitid.length).toBeGreaterThan(0);
    }
  });
});

describe("CSV grammar", () => {
  test("preserves raw cells and parses typed fields beside them", () => {
    const rows = Effect.runSync(parseBankCsv(spendingACsv, "required"));
    const newest = rows[0]!;

    expect(newest.raw).toEqual({
      date: "29/01/2032",
      amount: "-64.17",
      narrative: "FIXTURE SPENDING OFFSET TRANSACTION 0040",
      balance: "+6508.36",
    });
    expect(newest.postedDate).toBe("2032-01-29");
    expect(BigDecimal.equals(newest.amount, decimal("-64.17"))).toBe(true);
    expect(BigDecimal.equals(newest.balance!, decimal("6508.36"))).toBe(true);
  });

  test("preserves fixed-width Mastercard narrative spacing", () => {
    const rows = Effect.runSync(parseBankCsv(mastercardCsv, "forbidden"));

    expect(rows[0]!.raw.narrative).toBe("FIXTURE MASTERCARD 0102  SYDNEY      NSW");
    expect(rows[0]!.balance).toBeNull();
  });

  test("a quoted comma stays inside its cell", () => {
    const bytes = new TextEncoder().encode('29/01/2032,"-1.00","COFFEE, THE GOOD KIND","+1.00"\r\n');

    const rows = Effect.runSync(parseBankCsv(bytes, "required"));
    expect(rows[0]!.raw.narrative).toBe("COFFEE, THE GOOD KIND");
  });

  test("a bare line feed blocks the file", () => {
    const bytes = new TextEncoder().encode('29/01/2032,"-1.00","A","+1.00"\n');

    expect(block(parseBankCsv(bytes, "required")).code).toBe("CsvGrammar");
  });

  test("a header row blocks the file", () => {
    const bytes = new TextEncoder().encode('Date,Amount,Description,Balance\r\n');

    expect(block(parseBankCsv(bytes, "required")).detail).toMatch(/DD\/MM\/YYYY/);
  });

  test("a populated balance blocks a profile that forbids one", () => {
    expect(block(parseBankCsv(spendingACsv, "forbidden")).code).toBe("CsvGrammar");
  });

  test("a missing balance blocks a profile that requires one", () => {
    expect(block(parseBankCsv(mastercardCsv, "required")).code).toBe("CsvGrammar");
  });

  test("windows-1252 narrative bytes decode without loss", () => {
    const narrative = [..."SNACKS "].map((c) => c.charCodeAt(0));
    const bytes = Uint8Array.from([
      ..."29/01/2032,\"-1.00\",\"".split("").map((c) => c.charCodeAt(0)),
      ...narrative,
      0x93, // Windows-1252 left double quotation — not Latin-1
      0x94,
      ...'","+1.00"\r\n'.split("").map((c) => c.charCodeAt(0)),
    ]);

    const rows = Effect.runSync(parseBankCsv(bytes, "required"));
    expect(rows[0]!.raw.narrative).toBe("SNACKS “”");
  });
});

describe("OFX grammar", () => {
  test("scalar values keep exact source text including balances", () => {
    const statement = Effect.runSync(parseBankOfx(spendingAOfx, "deposit"));

    expect(statement.transactions[0]!.raw).toEqual({
      TRNTYPE: "DEBIT",
      DTPOSTED: "20320129",
      DTUSER: "20320127",
      TRNAMT: "-64.17",
      FITID: "fixture-fitid-1-000040",
      MEMO: "FIXTURE SPENDING OFFSET TRANSACTION 0040",
    });
    expect(statement.transactions[0]!.valueDate).toBe("2032-01-27");
    expect(BigDecimal.equals(statement.ledger!.amount, decimal("6508.36"))).toBe(true);
    expect(statement.ledger!.asOfDate).toBe("2032-01-29");
    expect(BigDecimal.equals(statement.available!.amount, decimal("9008.36"))).toBe(true);
  });

  test("the home-loan CCSTMTRS/STMTRS pair is accepted only for that profile", () => {
    expect(Effect.runSync(parseBankOfx(homeLoanOfx, "home_loan")).account.acctType).toBe(
      "CREDITLINE",
    );
    expect(block(parseBankOfx(homeLoanOfx, "deposit")).code).toBe("OfxGrammar");
  });

  test("a deposit file parsed as credit card blocks on shape", () => {
    expect(block(parseBankOfx(spendingAOfx, "credit_card")).code).toBe("OfxGrammar");
  });

  test("an unknown element blocks the file", () => {
    const text = new TextDecoder().decode(spendingAOfx).replace("<MEMO>", "<NAME>");
    const bytes = new TextEncoder().encode(text);

    expect(block(parseBankOfx(bytes, "deposit")).detail).toMatch(/NAME/);
  });

  test("a non-AUD currency blocks the file", () => {
    const text = new TextDecoder().decode(spendingAOfx).replace("<CURDEF>AUD", "<CURDEF>USD");
    const bytes = new TextEncoder().encode(text);

    expect(block(parseBankOfx(bytes, "deposit")).code).toBe("CurrencyUnsupported");
  });
});

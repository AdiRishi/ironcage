import { BigDecimal, Effect } from "effect";
import { describe, expect, test } from "vitest";

import type { BankImportBlocked } from "../../src/money/block";
import { bundleDigest, validatePairedBundle } from "../../src/money/bundle";
import { parseBankCsv } from "../../src/money/csv";
import { parseBankOfx } from "../../src/money/ofx";
import homeLoanCsv from "../fixtures/money/commbank/home-loan/home-loan-a.csv?bytes";
import homeLoanOfx from "../fixtures/money/commbank/home-loan/home-loan-a.ofx?bytes";
import mastercardCsv from "../fixtures/money/commbank/mastercard/mastercard-a.csv?bytes";
import mastercardOfx from "../fixtures/money/commbank/mastercard/mastercard-a.ofx?bytes";
import spendingCsv from "../fixtures/money/commbank/spending-offset/spending-offset-a.csv?bytes";
import spendingOfx from "../fixtures/money/commbank/spending-offset/spending-offset-a.ofx?bytes";

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const bytes = (value: string) => new TextEncoder().encode(value);

const spending = () => ({
  csv: Effect.runSync(parseBankCsv(spendingCsv, "required")),
  ofx: Effect.runSync(parseBankOfx(spendingOfx, "deposit")),
});

const block = (effect: Effect.Effect<unknown, BankImportBlocked>): BankImportBlocked =>
  Effect.runSync(Effect.flip(effect));

describe("paired bundle validation", () => {
  test("the spending offset pair validates and reconciles its ledger", () => {
    const { csv, ofx } = spending();
    const bundle = Effect.runSync(validatePairedBundle("deposit", csv, ofx));

    expect(bundle.candidates).toHaveLength(40);
    expect(bundle.ledgerReconciled).toBe(true);
    expect(bundle.window).toEqual({ start: "2031-12-11", end: "2032-01-29" });
    expect(
      bundle.candidates.every(({ csv: row, ofx: partner }) =>
        BigDecimal.equals(row.amount, partner.amount),
      ),
    ).toBe(true);
  });

  test("the home loan validates with negative balances intact", () => {
    const csv = Effect.runSync(parseBankCsv(homeLoanCsv, "required"));
    const ofx = Effect.runSync(parseBankOfx(homeLoanOfx, "home_loan"));

    const bundle = Effect.runSync(validatePairedBundle("credit_line", csv, ofx));
    expect(bundle.candidates).toHaveLength(36);
  });

  test("the mastercard validates without row balances", () => {
    const csv = Effect.runSync(parseBankCsv(mastercardCsv, "forbidden"));
    const ofx = Effect.runSync(parseBankOfx(mastercardOfx, "credit_card"));

    const bundle = Effect.runSync(validatePairedBundle("credit_card", csv, ofx));
    expect(bundle.candidates).toHaveLength(102);
    expect(bundle.ledgerReconciled).toBe(false);
    expect(bundle.ledger).not.toBeNull();
  });

  test("equal rows receive distinct occurrences in source order", () => {
    const row = '25/01/2032,"-5.00","SAME COFFEE","+95.00"\r\n';
    const csv = Effect.runSync(
      parseBankCsv(bytes(`25/01/2032,"-5.00","SAME COFFEE","+90.00"\r\n${row}`), "required"),
    );
    // Two OFX twins of the same (date, amount, memo).
    const twin = (fitid: string) =>
      `<STMTTRN>\r\n<TRNTYPE>DEBIT\r\n<DTPOSTED>20320125\r\n<DTUSER>20320125\r\n<TRNAMT>-5.00\r\n<FITID>${fitid}\r\n<MEMO>SAME COFFEE\r\n</STMTTRN>\r\n`;
    const ofx = Effect.runSync(
      parseBankOfx(
        bytes(
          text(spendingOfx)
            .replace(
              /<STMTTRN>[\s\S]*<\/BANKTRANLIST>/,
              `${twin("f-1")}${twin("f-2")}</BANKTRANLIST>`,
            )
            .replace("<DTSTART>20311211000000", "<DTSTART>20320125000000")
            .replace("<BALAMT>6508.36", "<BALAMT>90.00"),
        ),
        "deposit",
      ),
    );

    const bundle = Effect.runSync(validatePairedBundle("deposit", csv, ofx));
    expect(bundle.candidates.map((candidate) => candidate.occurrence)).toEqual([1, 2]);
    expect(bundle.candidates.map((candidate) => candidate.ofx.fitid)).toEqual(["f-1", "f-2"]);
  });

  test("a conflicting narrative blocks the pair", () => {
    const { csv, ofx } = spending();
    const tampered = csv.map((row, index) =>
      index === 3 ? { ...row, raw: { ...row.raw, narrative: "SOMETHING ELSE" } } : row,
    );

    expect(block(validatePairedBundle("deposit", tampered, ofx)).code).toBe("PairingMismatch");
  });

  test("unequal row counts block before pairing", () => {
    const { csv, ofx } = spending();

    expect(block(validatePairedBundle("deposit", csv.slice(1), ofx)).code).toBe("PairingMismatch");
  });

  test("a broken balance chain blocks the bundle", () => {
    const tampered = text(spendingCsv).replace('"+6572.53"', '"+6572.54"');
    const csv = Effect.runSync(parseBankCsv(bytes(tampered), "required"));
    const { ofx } = spending();

    expect(block(validatePairedBundle("deposit", csv, ofx)).code).toBe("BalanceChainFailed");
  });

  test("a ledger disagreement blocks the bundle", () => {
    const { csv } = spending();
    const ofx = Effect.runSync(
      parseBankOfx(
        bytes(text(spendingOfx).replace("<BALAMT>6508.36", "<BALAMT>6508.37")),
        "deposit",
      ),
    );

    expect(block(validatePairedBundle("deposit", csv, ofx)).code).toBe("LedgerMismatch");
  });

  test("rows out of newest-first order block the bundle", () => {
    const { csv, ofx } = spending();

    expect(block(validatePairedBundle("deposit", [...csv].reverse(), ofx)).code).toBe("RowOrder");
    const reordered = [csv[1]!, csv[0]!, ...csv.slice(2)];
    expect(block(validatePairedBundle("deposit", reordered, ofx)).code).toBe("RowOrder");
  });

  test("a populated FITID on an empty-FITID profile blocks", () => {
    const csv = Effect.runSync(parseBankCsv(mastercardCsv, "forbidden"));
    const ofx = Effect.runSync(
      parseBankOfx(
        bytes(text(mastercardOfx).replace("<FITID>\r\n<MEMO>", "<FITID>surprise\r\n<MEMO>")),
        "credit_card",
      ),
    );

    expect(block(validatePairedBundle("credit_card", csv, ofx)).detail).toMatch(/populated FITID/);
  });

  test("an ACCTTYPE outside the profile blocks", () => {
    const csv = Effect.runSync(parseBankCsv(homeLoanCsv, "required"));
    const ofx = Effect.runSync(parseBankOfx(homeLoanOfx, "home_loan"));

    expect(block(validatePairedBundle("deposit", csv, ofx)).detail).toMatch(/CREDITLINE/);
  });

  test("600 logical rows block as truncated", () => {
    const csvLines: string[] = [];
    const ofxRows: string[] = [];
    for (let index = 0; index < 600; index += 1) {
      csvLines.push(`29/01/2032,"-1.00","ROW ${index}","+${(10_000 + index).toFixed(2)}"`);
      ofxRows.push(
        `<STMTTRN>\r\n<TRNTYPE>DEBIT\r\n<DTPOSTED>20320129\r\n<DTUSER>20320129\r\n<TRNAMT>-1.00\r\n<FITID>f-${index}\r\n<MEMO>ROW ${index}\r\n</STMTTRN>\r\n`,
      );
    }
    const csv = Effect.runSync(parseBankCsv(bytes(`${csvLines.join("\r\n")}\r\n`), "required"));
    const ofx = Effect.runSync(
      parseBankOfx(
        bytes(
          text(spendingOfx).replace(
            /<STMTTRN>[\s\S]*<\/BANKTRANLIST>/,
            `${ofxRows.join("")}</BANKTRANLIST>`,
          ),
        ),
        "deposit",
      ),
    );

    expect(block(validatePairedBundle("deposit", csv, ofx)).code).toBe("ExportTruncated");
  });

  test("the bundle digest is order-independent over roles", async () => {
    const files = [
      { role: "csv", digest: "a".repeat(64) },
      { role: "ofx", digest: "b".repeat(64) },
    ];

    expect(await bundleDigest("cba-netbank-paired-v1", "account", files)).toBe(
      await bundleDigest("cba-netbank-paired-v1", "account", [...files].reverse()),
    );
    expect(await bundleDigest("cba-netbank-paired-v1", "account", files)).not.toBe(
      await bundleDigest("cba-netbank-paired-v1", "other-account", files),
    );
  });
});

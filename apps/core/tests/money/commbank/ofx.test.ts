import { it } from "@effect/vitest";
import { BigDecimal, Effect, Option } from "effect";
import { describe, expect } from "vitest";

import { CommBankOfxRejected, decodeCommBankOfx } from "../../../src/money/commbank/ofx";
import {
  type CommBankAccountProfile,
  commBankAccountProfiles,
} from "../../../src/money/commbank/profiles";
import homeLoanA from "../../fixtures/money/commbank/home-loan/home-loan-a.ofx?bytes";
import mastercardA from "../../fixtures/money/commbank/mastercard/mastercard-a.ofx?bytes";
import savingsA from "../../fixtures/money/commbank/savings-offset/savings-offset-a.ofx?bytes";
import spendingA from "../../fixtures/money/commbank/spending-offset/spending-offset-a.ofx?bytes";
import spendingB from "../../fixtures/money/commbank/spending-offset/spending-offset-b.ofx?bytes";
import spendingC from "../../fixtures/money/commbank/spending-offset/spending-offset-c.ofx?bytes";

const profiles = commBankAccountProfiles;

/** Independently reviewed counts and requested windows from the source exports. */
const corpus = [
  {
    id: "spending-offset-a",
    profile: profiles["spending-offset"],
    bytes: spendingA,
    rows: 40,
    window: { start: "2026-06-20", end: "2026-08-08" },
  },
  {
    id: "spending-offset-b",
    profile: profiles["spending-offset"],
    bytes: spendingB,
    rows: 25,
    window: { start: "2026-07-01", end: "2026-07-31" },
  },
  {
    id: "spending-offset-c",
    profile: profiles["spending-offset"],
    bytes: spendingC,
    rows: 23,
    window: { start: "2026-07-15", end: "2026-08-08" },
  },
  {
    id: "savings-offset-a",
    profile: profiles["savings-offset"],
    bytes: savingsA,
    rows: 40,
    window: { start: "2024-12-03", end: "2026-03-26" },
  },
  {
    id: "mastercard-a",
    profile: profiles.mastercard,
    bytes: mastercardA,
    rows: 102,
    window: { start: "2026-07-01", end: "2026-07-31" },
  },
  {
    id: "home-loan-a",
    profile: profiles["home-loan"],
    bytes: homeLoanA,
    rows: 36,
    window: { start: "2024-08-08", end: "2026-08-08" },
  },
] as const;

const encode = (text: string) => new TextEncoder().encode(text.replaceAll("\n", "\r\n"));

/**
 * A minimal synthetic document in the observed shape, for the fail-closed
 * cases. Each rejection substitutes one fragment of it, so the test names the
 * single thing that made the file unreadable.
 */
const defaultHeader =
  "OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\nSECURITY:NONE\nENCODING:USASCII\nCHARSET:1252\nCOMPRESSION:NONE\nOLDFILEUID:NONE\nNEWFILEUID:NONE\n";

const defaultBody = `<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<CURDEF>AUD
<BANKACCTFROM>
<BANKID>999999
<ACCTID>10000001
<ACCTTYPE>SAVINGS
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20311211000000
<DTEND>20320129000000
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20320129
<DTUSER>20320127
<TRNAMT>-64.17
<FITID>fixture-fitid-1-000040
<MEMO>FIXTURE SPENDING OFFSET TRANSACTION 0040
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>6508.36
<DTASOF>20320129104618
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>
`;

const document = (options: { header?: string; body?: string } = {}) =>
  encode(`${options.header ?? defaultHeader}${options.body ?? defaultBody}`);

const bodyWithout = (fragment: string, replacement: string) => {
  if (!defaultBody.includes(fragment)) {
    throw new Error(`the synthetic document does not contain ${JSON.stringify(fragment)}`);
  }

  return defaultBody.replace(fragment, replacement);
};

describe("the observed corpus", () => {
  for (const { id, profile, bytes, rows, window } of corpus) {
    it.effect(`${id} decodes to its reviewed count and window`, () =>
      Effect.gen(function* () {
        const file = yield* decodeCommBankOfx(bytes, profile);

        expect(file.transactions).toHaveLength(rows);
        expect(file.window).toEqual(window);
        expect(file.currency).toBe("AUD");
        expect(file.transactions.map((entry) => entry.sourceOrdinal)).toEqual([
          ...Array(rows).keys(),
        ]);
      }),
    );
  }

  it.effect("reads the account identity the CSV beside it cannot supply", () =>
    Effect.gen(function* () {
      const file = yield* decodeCommBankOfx(spendingA, profiles["spending-offset"]);

      expect(file.account).toEqual({
        messageSet: "bank",
        bankId: Option.some("000000"),
        accountId: "10000001",
        accountType: Option.some("SAVINGS"),
      });
    }),
  );

  it.effect("reads a card account from the credit-card message set", () =>
    Effect.gen(function* () {
      const file = yield* decodeCommBankOfx(mastercardA, profiles.mastercard);

      expect(file.account.messageSet).toBe("credit_card");
      expect(file.account.accountId).toBe("4111111111111111");
      expect(Option.isNone(file.account.bankId)).toBe(true);
      expect(Option.isNone(file.account.accountType)).toBe(true);
    }),
  );

  it.effect("keeps every transaction field as the file wrote it", () =>
    Effect.gen(function* () {
      const file = yield* decodeCommBankOfx(spendingA, profiles["spending-offset"]);

      expect(file.transactions.at(0)?.raw).toEqual({
        type: "DEBIT",
        postedDate: "20260808",
        userDate: "20260806",
        amount: "-6.20",
        identifier: "R321140476753_267412",
        narrative: "TFNSW OPAL FARE SYDNEY AUS Card xx0000 Value Date: 06/08/2026",
      });
      expect(file.transactions.at(0)?.postedDate).toBe("2026-08-08");
      expect(file.transactions.at(0)?.userDate).toEqual(Option.some("2026-08-06"));
    }),
  );

  // The deposit profile's identifier is what tier 1 deduplication rests on, and
  // it is stable across the three overlapping windows by construction.
  it.effect("carries a FITID on every deposit row", () =>
    Effect.gen(function* () {
      const file = yield* decodeCommBankOfx(spendingA, profiles["spending-offset"]);

      expect(profiles["spending-offset"].identifier).toBe("stable");
      expect(file.transactions.every((entry) => Option.isSome(entry.identifier))).toBe(true);
    }),
  );

  it.effect("shares its FITID values across the overlapping windows", () =>
    Effect.gen(function* () {
      const a = yield* decodeCommBankOfx(spendingA, profiles["spending-offset"]);
      const b = yield* decodeCommBankOfx(spendingB, profiles["spending-offset"]);
      const identifiers = (file: typeof a) =>
        new Set(file.transactions.flatMap((entry) => Option.toArray(entry.identifier)));
      const shared = [...identifiers(b)].filter((value) => identifiers(a).has(value));

      expect(shared).toHaveLength(25);
    }),
  );

  // An empty element is not an identifier. Reading it as the empty string would
  // give every Mastercard row the same key.
  it.effect("reads an empty FITID as no identifier at all", () =>
    Effect.gen(function* () {
      const card = yield* decodeCommBankOfx(mastercardA, profiles.mastercard);
      const loan = yield* decodeCommBankOfx(homeLoanA, profiles["home-loan"]);

      expect(profiles.mastercard.identifier).toBe("absent");
      expect(profiles["home-loan"].identifier).toBe("absent");
      expect(card.transactions.every((entry) => Option.isNone(entry.identifier))).toBe(true);
      expect(loan.transactions.every((entry) => Option.isNone(entry.identifier))).toBe(true);
    }),
  );

  it.effect("accepts the home-loan aggregate exactly as NetBank emitted it", () =>
    Effect.gen(function* () {
      const source = new TextDecoder().decode(homeLoanA);
      const file = yield* decodeCommBankOfx(homeLoanA, profiles["home-loan"]);

      expect(source).toContain("<CCSTMTRS>\r\n");
      expect(source).toContain("</STMTRS>\r\n");
      expect(profiles["home-loan"].statementAggregate).toEqual({
        opening: "CCSTMTRS",
        closing: "STMTRS",
      });
      expect(file.transactions).toHaveLength(36);
    }),
  );

  it.effect("keeps ledger and available balance apart", () =>
    Effect.gen(function* () {
      const file = yield* decodeCommBankOfx(spendingA, profiles["spending-offset"]);
      const available = Option.getOrThrow(file.availableBalance);

      expect(BigDecimal.format(file.ledgerBalance.amount)).toBe("21561.27");
      expect(file.ledgerBalance.asOfDate).toBe("2026-08-08");
      expect(file.ledgerBalance.raw).toBe("20260808104618");
      expect(BigDecimal.format(available.amount)).toBe("21481.53");
    }),
  );
});

describe("refusing a file it cannot interpret", () => {
  const rejectionOf = (
    bytes: Uint8Array,
    profile: CommBankAccountProfile = profiles["spending-offset"],
  ) => Effect.flip(decodeCommBankOfx(bytes, profile));

  it.effect("rejects a version it has no grammar for", () =>
    Effect.gen(function* () {
      const rejected = yield* rejectionOf(
        document({
          header:
            "OFXHEADER:200\nDATA:OFXSGML\nVERSION:211\nSECURITY:NONE\nENCODING:USASCII\nCHARSET:1252\nCOMPRESSION:NONE\n",
        }),
      );

      expect(rejected).toBeInstanceOf(CommBankOfxRejected);
      expect(rejected.reason).toBe("unsupported_header");
      expect(rejected.detail).toContain("OFXHEADER");
    }),
  );

  it.effect("rejects a compressed body it would only be guessing at", () =>
    Effect.gen(function* () {
      const rejected = yield* rejectionOf(
        document({
          header:
            "OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\nSECURITY:NONE\nENCODING:USASCII\nCHARSET:1252\nCOMPRESSION:GZIP\n",
        }),
      );

      expect(rejected.reason).toBe("unsupported_header");
      expect(rejected.detail).toContain("COMPRESSION");
    }),
  );

  it.effect("rejects a file with no document at all", () =>
    Effect.gen(function* () {
      const rejected = yield* rejectionOf(encode("OFXHEADER:100\nDATA:OFXSGML\n"));

      expect(rejected.reason).toBe("missing_header");
    }),
  );

  it.effect("rejects the other message set for the selected account", () =>
    Effect.gen(function* () {
      const rejected = yield* rejectionOf(mastercardA);

      expect(rejected.reason).toBe("message_set_mismatch");
      expect(rejected.detail).toContain("CREDITCARDMSGSRSV1");
    }),
  );

  it.effect("rejects a currency the system does not account in", () =>
    Effect.gen(function* () {
      const rejected = yield* rejectionOf(
        document({ body: bodyWithout("<CURDEF>AUD", "<CURDEF>USD") }),
      );

      expect(rejected.reason).toBe("unsupported_currency");
    }),
  );

  it.effect("rejects a document that ends with elements still open", () =>
    Effect.gen(function* () {
      const rejected = yield* rejectionOf(document({ body: bodyWithout("</OFX>\n", "") }));

      expect(rejected.reason).toBe("malformed_sgml");
    }),
  );

  it.effect("rejects a closing tag that never opened", () =>
    Effect.gen(function* () {
      const rejected = yield* rejectionOf(
        document({ body: bodyWithout("</OFX>\n", "</CCSTMTRS>\n</OFX>\n") }),
      );

      expect(rejected.reason).toBe("malformed_sgml");
    }),
  );

  // Only the home-loan profile declares NetBank's mismatched statement tags.
  // The same mismatch remains malformed for a normal bank-statement profile.
  it.effect("rejects an aggregate closed under a different name", () =>
    Effect.gen(function* () {
      const rejected = yield* rejectionOf(
        document({ body: bodyWithout("<STMTRS>\n", "<CCSTMTRS>\n") }),
      );

      expect(rejected.reason).toBe("malformed_sgml");
    }),
  );

  it.effect("rejects a transaction with no narrative element", () =>
    Effect.gen(function* () {
      const rejected = yield* rejectionOf(
        document({
          body: bodyWithout("<MEMO>FIXTURE SPENDING OFFSET TRANSACTION 0040\n", ""),
        }),
      );

      expect(rejected.reason).toBe("missing_element");
      expect(rejected.detail).toContain("MEMO");
    }),
  );

  it.effect("rejects two ledger balances rather than choosing one", () =>
    Effect.gen(function* () {
      const rejected = yield* rejectionOf(
        document({
          body: bodyWithout(
            "<LEDGERBAL>\n<BALAMT>6508.36\n<DTASOF>20320129104618\n</LEDGERBAL>\n",
            "<LEDGERBAL>\n<BALAMT>6508.36\n<DTASOF>20320129104618\n</LEDGERBAL>\n<LEDGERBAL>\n<BALAMT>9008.36\n<DTASOF>20320129104618\n</LEDGERBAL>\n",
          ),
        }),
      );

      expect(rejected.reason).toBe("duplicate_element");
    }),
  );

  it.effect("rejects an amount that is not a decimal", () =>
    Effect.gen(function* () {
      const rejected = yield* rejectionOf(
        document({ body: bodyWithout("<TRNAMT>-64.17", "<TRNAMT>-64.17AUD") }),
      );

      expect(rejected.reason).toBe("invalid_amount");
      expect(rejected.sourceOrdinal).toBe(0);
    }),
  );

  it.effect("rejects a posted date that never happened", () =>
    Effect.gen(function* () {
      const rejected = yield* rejectionOf(
        document({ body: bodyWithout("<DTPOSTED>20320129", "<DTPOSTED>20320230") }),
      );

      expect(rejected.reason).toBe("invalid_date");
      expect(rejected.sourceOrdinal).toBe(0);
    }),
  );
});

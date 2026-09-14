import { Buffer } from "node:buffer";

import { expect, it } from "@effect/vitest";
import { reconcile } from "@repo/finance";
import { Effect } from "effect";

import { parseOfx } from "../../src/imports/ofx.ts";

const statement = (account: string, open: string, close: string) => `OFXHEADER:100
DATA:OFXSGML
VERSION:102
ENCODING:USASCII
CHARSET:1252

<OFX>${open}<CURDEF>AUD
${account}<BANKTRANLIST><DTSTART>20260801000000<DTEND>20260831235959
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260830<DTUSER>20260829<TRNAMT>-12.50<FITID>
<MEMO>Café &amp; Cake Value Date: 29/08/2026</STMTTRN></BANKTRANLIST>
<LEDGERBAL><BALAMT>-1234.56<DTASOF>20260831140000</LEDGERBAL>
<AVAILBAL><BALAMT>8765.44<DTASOF>20260831140000</AVAILBAL>${close}</OFX>`;

it.effect(
  "reads deposit, card, and CommBank's malformed loan envelope without losing empty FITIDs",
  () =>
    Effect.gen(function* () {
      const cases = [
        {
          kind: "deposit",
          bankId: "123456",
          account: "<BANKACCTFROM><BANKID>123456<ACCTID>11111111<ACCTTYPE>SAVINGS</BANKACCTFROM>",
          open: "<BANKMSGSRSV1><STMTTRNRS><STMTRS>",
          close: "</STMTRS></STMTTRNRS></BANKMSGSRSV1>",
        },
        {
          kind: "card",
          bankId: null,
          account: "<CCACCTFROM><ACCTID>11111111</CCACCTFROM>",
          open: "<CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS>",
          close: "</CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1>",
        },
        {
          kind: "loan",
          bankId: "123456",
          account:
            "<BANKACCTFROM><BANKID>123456<ACCTID>11111111<ACCTTYPE>CREDITLINE</BANKACCTFROM>",
          open: "<BANKMSGSRSV1><STMTTRNRS><CCSTMTRS>",
          close: "</STMTRS></STMTTRNRS></BANKMSGSRSV1>",
        },
      ];
      for (const input of cases) {
        const parsed = yield* parseOfx(
          Buffer.from(statement(input.account, input.open, input.close), "latin1"),
        );
        expect(parsed.account).toEqual({
          kind: input.kind,
          bankId: input.bankId,
          accountNumber: "11111111",
          currency: "AUD",
        });
        expect(parsed.observations).toHaveLength(1);
        expect(parsed.observations[0]?.candidate).toMatchObject({
          postedOn: "2026-08-30",
          valueOn: "2026-08-29",
          description: "Café & Cake",
          amount: { currency: "AUD", minor: -1250n },
          bankId: null,
        });
        expect(parsed.observations[0]?.raw.MEMO).toBe("Café &amp; Cake Value Date: 29/08/2026");
        expect(parsed.statement.closing).toEqual({
          on: "2026-08-31",
          money: { currency: "AUD", minor: -123456n },
        });
        expect(parsed.statement.raw.AVAILBAL_BALAMT).toBe("8765.44");
        expect(reconcile(parsed).reconciled).toBe(false);
      }
    }),
);

it.effect("an end-of-day ledger snapshot anchors the following calendar day", () =>
  Effect.gen(function* () {
    const text = statement(
      "<CCACCTFROM><ACCTID>22222222</CCACCTFROM>",
      "<CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS>",
      "</CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1>",
    ).replaceAll("20260831140000", "20260831235959");
    const parsed = yield* parseOfx(new TextEncoder().encode(text));
    expect(parsed.statement.closing.on).toBe("2026-09-01");
  }),
);

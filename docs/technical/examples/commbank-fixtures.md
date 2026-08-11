# Fictional CommBank fixture shapes

These examples preserve structures observed in the private sample corpus. Every name, account identifier, amount, date, reference, and balance below is invented. They are documentation examples, not production parser fixtures.

The first redacted observed corpus lives in the core test tree at [`apps/core/tests/fixtures/money/commbank`](../../../apps/core/tests/fixtures/money/commbank/README.md). It covers all four structured account profiles plus three overlapping spending-offset windows without changing delimiters, quoting, encodings, line endings, empty fields, tag order, or other parser-significant syntax. Its manifest names the difficult input shapes that were absent from the private samples and therefore remain open fixture gates. Raw bank files never belong in the repository.

## Deposit CSV

The file is headerless. The values below are shown in the observed newest-first order.

```csv
05/08/2026,"-42.75","Card xx1122 FICTIONAL GROCER NEWTOWN AU Value Date: 04/08/2026","2457.25"
04/08/2026,"+2500.00","Direct Credit 123456 EXAMPLE EMPLOYER PAYROLL","2500.00"
```

The amount, narrative, and balance cells are quoted. The corresponding chronological balance check is `0.00 + 2500.00 - 42.75 = 2457.25`.

## Mastercard CSV

Mastercard retains the fourth cell but leaves it empty.

```csv
05/08/2026,"-18.40","Card xx3344 EXAMPLE CAFE SYDNEY AU Value Date: 04/08/2026",""
03/08/2026,"+750.00","PAYMENT RECEIVED - THANK YOU",""
```

The empty fourth cell is why Markdown table conversion is not the authoritative CSV parser.

## Home-loan CSV

The observed home-loan profile carries a negative running balance.

```csv
01/08/2026,"-1240.50","INTEREST CHARGED","-481240.50"
31/07/2026,"+3000.00","PAYMENT RECEIVED","-480000.00"
```

The source description is preserved. A later transfer match can classify the payment as principal movement, while interest remains housing spending.

## Deposit OFX

This is SGML-style OFX 1.02. Scalar fields intentionally have no closing tags.

```ofx
OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE

<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<CURDEF>AUD
<BANKACCTFROM>
<BANKID>999999
<ACCTID>00000000
<ACCTTYPE>SAVINGS
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20260801000000
<DTEND>20260805000000
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260805
<DTUSER>20260805
<TRNAMT>-42.75
<FITID>fictional-fitid-0001
<MEMO>Card xx1122 FICTIONAL GROCER NEWTOWN AU Value Date: 04/08/2026
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>2457.25
<DTASOF>20260805000000
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>
```

The CSV and OFX row pair exactly on date, signed amount, and raw narrative. The OFX adds account identity and a `FITID`.

## Mastercard and home-loan identifiers

The observed Mastercard and home-loan OFX samples contained an empty `FITID` element.

```ofx
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260805
<DTUSER>20260805
<TRNAMT>-18.40
<FITID>
<MEMO>Card xx3344 EXAMPLE CAFE SYDNEY AU Value Date: 04/08/2026
</STMTTRN>
```

An empty element is not an identifier. Home-loan rows use their running balance. Mastercard rows use the explicit content-occurrence fallback and surface count mismatches as ambiguous.

## Extracted offset-statement Markdown

AnyDoc can represent one visual transaction as several Markdown rows. The statement state machine joins continuation rows before parsing the amount and balance.

```markdown
| Date  | Transaction                  |  Debit | Credit |      Balance |
| ----- | ---------------------------- | -----: | -----: | -----------: |
| 5 Aug | Card xx1122 FICTIONAL GROCER | $42.75 |        | $2,457.25 CR |
|       | NEWTOWN AU                   |        |        |              |
|       | Foreign Currency AUD 42.75   |        |        |              |
```

The completed transaction is:

```text
posted date     2026-08-05
amount          -42.75
raw narrative   Card xx1122 FICTIONAL GROCER\nNEWTOWN AU\nForeign Currency AUD 42.75
row balance     +2457.25
```

A fictional statement summary looks like:

```markdown
| Opening balance | Total debits | Total credits | Closing balance |
| --------------: | -----------: | ------------: | --------------: |
|        $0.00 CR |       $42.75 |     $2,500.00 |    $2,457.25 CR |
```

The parser recomputes `0.00 - 42.75 + 2500.00 = 2457.25`. It does not trust the extracted summary without that proof.

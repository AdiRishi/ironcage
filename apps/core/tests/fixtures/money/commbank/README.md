# CommBank structured-export fixtures

These files are minimally redacted copies of the downloaded NetBank CSV/OFX
pairs. Dates, amounts, balances, requested windows, row order, CSV quoting,
empty fields, OFX tags, and CRLF line endings remain as the bank emitted them.
Direct account and transaction identifiers were replaced consistently; masked
card suffixes, personal payee names, the salary payer, and long customer
references inside narratives were also substituted. The remaining narrative
wording is unchanged. No financial or structural values were regenerated.

The corpus contains all four supported account profiles and three naturally
overlapping spending-offset windows. The home-loan OFX genuinely opens its bank
statement with `<CCSTMTRS>` and closes it with `</STMTRS>`; that source quirk is
preserved here and declared by the home-loan parser profile.

Synthetic inputs in the decoder and reconciliation suites are ordinary test
evidence for conditions that do not naturally occur in these exports, including
quoted commas, non-ASCII bytes, empty results, repeated equal rows, and the
600-row truncation rule. Additional bank downloads can add regression coverage,
but are not prerequisites for implementing or testing those behaviors.

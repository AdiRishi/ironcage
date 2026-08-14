# Redacted CommBank structured-export fixtures

These fixtures were derived from private NetBank exports and are safe to keep in
the repository. The raw exports are not here and must never be added. If private
fixture staging is ever necessary inside the workspace, use the ignored
`/.private-fixtures/` directory.

Every account identifier, transaction identifier, date, amount, balance, and
narrative is fictional. The redaction preserves the observed parser contract:

- headerless, four-column CSV with CRLF line endings;
- the original quoted-cell and empty-cell structure;
- the explicit `+` prefix on positive amounts and deposit running balances;
- fixed-width padded Mastercard purchase narratives beside a plain payment row;
- OFX 1.02 SGML tags, ordering, declared encoding, and CRLF line endings;
- exact CSV/OFX row order and pairing;
- per-row balance presence by account profile;
- empty versus populated `FITID` behavior; and
- overlap membership and stable fictional `FITID` values across the three
  spending-offset windows.

[`manifest.json`](./manifest.json) is the inventory and source of expected row
counts, source windows, observation counts, and overlap counts.

| Fixture             | Profile         | Rows | CSV balances | OFX `FITID` |
| ------------------- | --------------- | ---: | ------------ | ----------- |
| `spending-offset-a` | spending offset |   40 | every row    | every row   |
| `spending-offset-b` | spending offset |   25 | every row    | every row   |
| `spending-offset-c` | spending offset |   23 | every row    | every row   |
| `savings-offset-a`  | savings offset  |   40 | every row    | every row   |
| `mastercard-a`      | Mastercard      |  102 | empty        | empty       |
| `home-loan-a`       | home loan       |   36 | every row    | empty       |

The corpus is observed evidence, not a complete production acceptance suite.
The private exports did not contain a same-day equal-row collision, a quoted
comma, non-ASCII narrative bytes, an empty export, or a true 600-row capped
export. Tests may add explicitly labelled synthetic cases for fail-closed
behavior, but synthetic data does not close those fixture gates.

The reviewed statement is an eight-page, text-based A4 spending-offset PDF. It
is not committed because its values and layout contain private information.
Statement parsing remains a later tranche requiring a separately redacted PDF
and a matching structured-overlap fixture.

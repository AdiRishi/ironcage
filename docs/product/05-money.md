# Money

Money is the operator's banking picture. It combines imported transactions, categorized spending, balances, and coverage into one record that is useful before the investing engine exists. It reads money and never moves it. Portfolio owns the whole-of-wealth picture and consumes Money's cash and liability balances.

## Accounts in scope

The first release follows the four accounts that explain day-to-day cash flow and debt.

| Account         | What Money uses it for                                        |
| --------------- | ------------------------------------------------------------- |
| Spending offset | Income, bills, debit-card purchases, and primary cash balance |
| Savings offset  | Savings balance and matching transfers between owned accounts |
| Mastercard      | Card purchases, refunds, and the liability balance            |
| Home loan       | Loan balance, principal movements, interest, and fees         |

The empty CDIA and share accounts are omitted while they remain unused. Super belongs in Portfolio later because it is wealth, not spending activity.

Card repayments and home-loan principal are transfers between owned accounts. They do not become spending a second time. Card purchases remain expenses. Home-loan interest and fees are housing expenses.

## Bank import

The operator exports data from NetBank and uploads it to Money. Ironcage never stores NetBank credentials.

For recent history, one upload contains the CSV and OFX exported for the same account and date window. CSV supplies each row's running balance where CommBank provides one. OFX supplies account identity and the file-level ledger balance. The two files must describe exactly the same rows before the upload can continue.

For older history, Money accepts archived statements after the parser for that account's statement layout has passed its fixture tests. Statements are reconciled from their opening balance through every row to their closing balance. A statement never overrides a complete structured-export window.

The import flow is:

1. Select the two files for one recent-history bundle, or select one statement.
2. Preview the account, source window, coverage effect, balances, and row verdicts.
3. Resolve any rows the system cannot identify unambiguously.
4. Confirm the import.
5. Review categories that no rule recognized.

Nothing is stored before confirmation. The preview reports source rows, new transactions, known duplicates, ambiguities, and coverage gaps. A file for the wrong account is rejected before row matching begins. A structured export that reaches NetBank's observed 600-row ceiling is treated as truncated and cannot claim complete coverage.

Re-uploading the same files is safe. Overlapping exports are expected and recommended. The system counts each bank transaction once even when several uploads or source formats contain it.

The record distinguishes a bank transaction from the source observations that support it. A CSV/OFX pair and an overlapping statement may therefore provide several observations of one transaction. Every raw narrative and source file remains attached to that transaction for inspection.

Deduplication uses the strongest evidence the bank supplies:

- The exact file or bundle digest makes an identical re-upload idempotent.
- A proven bank transaction identifier is decisive within its account.
- A posted date, exact amount, and running balance identify rows on accounts that publish a balance for each transaction.
- Ordered occurrences distinguish repeated rows when no balance or identifier exists.
- Statement totals, balance sequences, account identity, and row order align statement observations with existing transactions.

Descriptions corroborate those decisions. They are not given an arbitrary fuzzy score. When two candidates remain plausible, Money asks the operator instead of silently dropping or double-counting a row.

## Collection and coverage

The recommended routine is one manual import on the fifth day of each month. Each account uses a rolling range from the first day of the previous month through the import day. The overlap captures transactions that posted after the prior export and continuously exercises deduplication.

The first backfill collects up to two years of structured CSV/OFX exports. Busy windows are split into quarters and then months when necessary. Adjacent windows overlap by seven days and are imported oldest to newest.

Older history comes from the statement archive. The operator should download all available statements now because the archive window moves forward over time. Statement parsing may follow the first useful release, but preserving the source files cannot wait.

Money maintains coverage separately for every required account. A missing interval is shown as a gap. A month with a gap in any required account is incomplete and is excluded from comparisons, averages, recurring-charge conclusions, and savings suggestions. The interface never renders missing history as zero spending.

Pending transactions are not present in the observed exports. Analysis is therefore current through the latest imported posted transaction, not through the card's pending activity. Every balance and analysis view displays its as-of date.

## Categorization

The default taxonomy includes housing, groceries, eating out, transport, utilities, subscriptions, health, travel, shopping, income, transfers, fees, and other. The operator can edit the taxonomy. A system-owned uncategorized state keeps pending review visible and cannot be deleted.

One transaction may be split across categories. Its split amounts must sum exactly to the signed transaction amount.

Rules run before AI. Correcting a payee can create a visible rule for future transactions. AI suggestions show their confidence and rationale, but every suggestion requires review at launch. Automatic application remains disabled until reviewed decisions provide enough evidence to calibrate a threshold.

Every assignment records whether it came from a rule, AI suggestion, or manual choice. The underlying source narrative never changes when a category changes.

Transfers between owned accounts are matched and excluded from income and spending. Refunds and reversals reduce the expense category they belong to. They never become income merely because their amount is positive.

## Analysis

- **Monthly view** shows net spending by category against trailing averages and opens every aggregate into its transactions.
- **Trends** show income, spending, savings rate, and category movement across complete months.
- **Recurring charges** show subscriptions and regular bills with their cadence, amount, and history.
- **Anomalies** surface unusually large transactions, new high-value payees, and category spikes.
- **Suggestions** describe specific savings opportunities with their reasoning, estimated annual effect, and supporting transactions.

Suggestions are recommendations only. Money never transfers funds, pays a bill, or changes an account.

## Tax and reports

Money supplies bank interest and bank-side funding movements to the tax engine. Tax owns their tax interpretation and any match to broker, exchange, or wallet records.

Money also supplies the monthly spending report. A report is generated only for a complete month. If coverage is incomplete, the report shows the missing account windows and remains unavailable until they are filled.

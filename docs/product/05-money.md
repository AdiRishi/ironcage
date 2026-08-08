# Money

The Money view is the operator's banking picture: imported transactions, categorized spending, and the analysis that turns them into insight. It reads everything and trades nothing — zero execution risk, which is why it ships first and is useful in week one. (The whole-of-wealth picture lives in [Portfolio](./04-portfolio.md); Money supplies its external account balances.)

## Bank import

**v1 is file import, by explicit decision.** CommBank NetBank exports transactions in CSV, OFX, and QIF with two years of transaction history available; automatic sync via the Consumer Data Right requires an accredited intermediary and is deliberately deferred — it becomes worth revisiting only if manual export proves to be the system's limiting annoyance.

The flow:

1. The operator exports from NetBank (any supported format — the importer auto-detects) and drops the file onto the Money view.
2. **Preview before commit**: the importer shows what it found — n transactions, m new, d duplicates of already-imported rows, k needing category review — before anything is written.
3. On confirm, new transactions are stored, categorized, and the analysis views update. The import itself becomes a feed event, and every import is listed in an import history with its source file name and counts.

Deduplication is stable across re-imports and overlapping exports: the same transaction imported twice is recognized and skipped, using exact matching on normalized account + date + amount + narrative, where the normalization absorbs the ways banks reformat narratives. Multiple accounts (transaction, savings, credit card) are supported and kept distinct, each carrying its balance as-of the export date — these balances are what the [Portfolio](./04-portfolio.md) view's net worth includes as external components.

The system never holds bank credentials. Transactions live in Ironcage's own store, exportable by the operator at any time.

## Categorization

Every transaction gets exactly one category (with support for manual splits — one transaction divided across categories). The taxonomy ships with a sensible default set (housing, groceries, eating out, transport, utilities, subscriptions, health, travel, shopping, income, transfers, fees, other) and is operator-editable.

Categorization is AI-assisted with stated confidence: at launch, every assignment goes through the operator's review; automatic application of high-confidence assignments is enabled only after an initial calibration period of that review, and low-confidence assignments are always flagged for the quick triage queue. **Corrections teach the system** — fixing a payee's category once creates a rule that applies henceforth, and rules are visible and editable, not buried in a model. Every AI categorization opens its decision record ([Activity](./03-activity.md)). Transfers between the operator's own accounts are detected and excluded from spending analysis rather than counted as expense and income.

## Analysis

- **Monthly view** — spending by category for any month against the trailing average, with drill-down to the underlying transactions. Every aggregate is one click from its rows.
- **Trends** — category and total spending over time; income vs. spending; savings rate.
- **Recurring charges** — detected subscriptions and regular bills, with amount, cadence, and history. A price change in a recurring charge is a feed event (`notice`).
- **Anomalies** — unusually large transactions, new payees above a threshold, category spikes; surfaced in the view and as `notice` feed events.
- **Suggestions** — concrete, recommend-only savings observations ("streaming subscriptions total $87/mo; two overlap", "this insurer's premium rose 34% year-on-year"), each with its reasoning and estimated annual impact, each traceable to the transactions behind it. Suggestions are never actions; the system moves no money here.

## Tax

Money's imported data also feeds the tax engine — interest income lines and the AUD legs of broker and exchange funding flows (see [Tax](./09-tax.md)). The running FY estimate surfaces on [Portfolio](./04-portfolio.md); the clean-records obligation stands independently: the full blotter and every ledger export as CSV in shapes an accountant can ingest directly.

## Reports

The Money view's data feeds the monthly spending report ([Reports](./06-reports.md)); the view itself is the interactive complement, always current as of the last import.

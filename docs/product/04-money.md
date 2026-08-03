# The Money view

The Money view is the insight arms' home: the whole of the operator's financial picture, powered by imported bank data and the sleeves' own records. It reads everything and trades nothing — zero execution risk, which is why it ships first and is useful in week one.

## Bank import

**v1 is file import, by explicit decision.** CommBank NetBank exports transactions in CSV, OFX, and QIF with two years of transaction history available; automatic sync via the Consumer Data Right requires an accredited intermediary and is deliberately deferred — it becomes worth revisiting only if manual export proves to be the system's limiting annoyance.

The flow:

1. The operator exports from NetBank (any supported format — the importer auto-detects) and drops the file onto the Money view.
2. **Preview before commit**: the importer shows what it found — n transactions, m new, d duplicates of already-imported rows, k needing category review — before anything is written.
3. On confirm, new transactions are stored, categorized, and the analysis views update. The import itself becomes a feed event, and every import is listed in an import history with its source file name and counts.

Deduplication is stable across re-imports and overlapping exports: the same transaction imported twice is recognized and skipped, using account + date + amount + narrative matching with a tolerance window for the ways banks reformat narratives. Multiple accounts (transaction, savings, credit card) are supported and kept distinct, each carrying its balance as-of the export date.

The system never holds bank credentials. Transactions live in Ironcage's own store, exportable by the operator at any time.

## Categorization

Every transaction gets exactly one category (with support for manual splits — one transaction divided across categories). The taxonomy ships with a sensible default set (housing, groceries, eating out, transport, utilities, subscriptions, health, travel, shopping, income, transfers, fees, other) and is operator-editable.

Categorization is AI-assisted with honest confidence: high-confidence assignments apply automatically; low-confidence ones are flagged for review in a quick triage queue. **Corrections teach the system** — fixing a payee's category once creates a rule that applies henceforth, and rules are visible and editable, not buried in a model. Transfers between the operator's own accounts are detected and excluded from spending analysis rather than counted as expense and income.

## Analysis

- **Monthly view** — spending by category for any month against the trailing average, with drill-down to the underlying transactions. Every aggregate is one click from its rows.
- **Trends** — category and total spending over time; income vs. spending; savings rate.
- **Recurring charges** — detected subscriptions and regular bills, with amount, cadence, and history. A price change in a recurring charge is a feed event (`notice`).
- **Anomalies** — unusually large transactions, new payees above a threshold, category spikes; surfaced in the view and as `notice` feed events.
- **Suggestions** — concrete, recommend-only savings observations ("streaming subscriptions total $87/mo; two overlap", "this insurer's premium rose 34% year-on-year"), each with its reasoning and estimated annual impact, each traceable to the transactions behind it. Suggestions are never actions; the system moves no money here.

## The portfolio picture

The whole-of-wealth view combines what Ironcage manages with what it merely observes:

- **Net worth over time** — sleeve equity (live and dry-run clearly separated) plus imported account balances, each component carrying its as-of date; stale imported balances are visibly dated, never silently presumed current.
- **Allocation** — the full breakdown: cash by account, each sleeve, and (once broker integration exists) holdings by asset class.
- This is also where the "include external balances" toggle on [Overview's](./01-overview.md) equity hero gets its data.

## Reports

The Money view's data feeds the monthly spending report ([Reports](./05-reports.md)); the view itself is the interactive complement, always current as of the last import.

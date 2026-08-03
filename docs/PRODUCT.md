# Ironcage — Product Specification

The [vision](./VISION.md) says why Ironcage exists and the principles that bind it. This document says what the system actually does: its surfaces, its behaviors, and the order in which its capabilities arrive. Where the two conflict, the vision wins and this document is wrong. The test of this document: a stranger should be able to read it and tell whether any behavior of the built system is correct or a bug, without reading code.

## Product shape

Ironcage is two things that meet in the middle: an **engine** that runs continuously and needs no one watching, and a **web application** that makes watching it worthwhile. The web app is not an admin panel bolted onto a bot — it is a first-class product and half the joy of the system. Every sleeve, every insight arm, every moving part gets its own living view: what it is doing right now, what it decided and why, how it is performing — presented with the care of something built to be *looked at*, not just checked. The design ambition is an observatory, not a control panel: data-dense, live, legible, and genuinely fun to watch.

The web app is also the only surface: the operator visits it, it never interrupts them. Its defining obligation follows: **opening it must answer "is everything okay?" within five seconds**, and the activity feed must make it impossible for anything important to have happened silently. If an event matters, it is in the feed; if it is unseen, the app says so.

There is exactly one operator. Every screen is built for that one person's trust and pleasure, not for a customer's.

## The sleeve

A sleeve is the product's central object: a bounded allocation of capital with its own rules of engagement. Creating, watching, and adjudicating sleeves *is* using Ironcage.

Every sleeve is defined by its **mandate**, which states:

- **Market and instruments** — e.g. spot BTC and ETH on Kraken; ASX-listed ETFs via the broker.
- **Strategy** — the systematic rules it runs, in one paragraph a human can understand. A strategy the operator can't explain doesn't get a sleeve.
- **Cadence** — how often it acts, from "rebalance quarterly" to "every 4-hour candle" to faster (experimental sleeves only).
- **Autonomy level** — how much of the decision loop AI holds (below).
- **Capital cap** — the maximum the sleeve may ever hold, in dollars. The allocator can give it less; nothing can give it more without a mandate change.
- **Risk limits** — the sleeve's own cage: position caps, stop-loss policy, daily loss halt, drawdown halt, trade-frequency cap.

A mandate is versioned configuration. Changing one is a deliberate, recorded act — not a slider on a live screen.

### Autonomy levels

Three named levels, set per sleeve in its mandate:

- **Level 0 — Clockwork.** Pure rules. No AI anywhere in the decision loop. Deterministic strategy logic decides everything within the cage. (The long-term wealth sleeve lives here.)
- **Level 1 — Advised.** The default for trading sleeves. Deterministic strategy decides what and when; AI contributes one bounded input — a regime assessment (ON / HALF / OFF) that can only scale position size down, never up, and never initiate. A stale or missing assessment reads as OFF.
- **Level 2 — Piloted.** Experimental. AI proposes individual trades; deterministic code validates every proposal against the mandate and the cage before anything reaches an exchange. This is the "full AI loop" the vision permits as a hard-capped experiment. Level 2 sleeves carry small caps permanently — they are instruments for learning, not scaling.

At every level, exits, stops, halts, and all risk-reducing actions are deterministic and cannot be blocked by AI output.

### The sleeve lifecycle

Sleeves move through named states, and the dashboard always shows each sleeve's state and how it got there:

**Draft → Dry run → Live → Halted / Retired**

- **Draft**: mandate written, nothing runs.
- **Dry run**: the sleeve trades simulated money against live markets through the same code path as live trading, with realistic simulated fills and fees. Every sleeve starts here, no exceptions.
- **Live**: real money, within the mandate's cap.
- **Halted**: stopped by the cage (automatically) or the operator (manually). Halted sleeves hold or unwind per their winddown policy; leaving Halted is always an operator action.
- **Retired**: closed, capital returned to the allocator, record kept forever.

**Promotion is the operator's decision — informed, never forced.** The system's default recommendation is three months of dry run before first live capital, but the operator can promote (or demote) any sleeve at any time. What the product guarantees is not a gate but *informed consent*: promotion happens on a **trial report** the system generates — performance against benchmarks (including buy-and-hold), drawdown, costs, and whether behavior matched the backtest — and the report, the timing, and the decision are permanently recorded. The system never blocks the operator's allocation choices; it makes them explicit, documented, and impossible to misremember.

**Halts, by contrast, are automatic.** Cage breaches (daily loss, drawdown, reconciliation failure) halt a sleeve without asking. Capital allocation is a choice; risk response is not.

## Modes, controls, and the break-glass override

Risk-reducing actions are always available and never gated: pause a sleeve, flatten its positions, halt everything. The dashboard offers them plainly.

Risk-increasing actions go through the mandate (a config change) — with one exception. The **break-glass override** exists for the moment the operator decides, with open eyes, to act outside a limit: it requires typing a confirmation phrase stating what is being overridden, then a **15-minute cooling-off delay** before the override becomes active, and it expires automatically after 24 hours. An active override is displayed prominently on every dashboard view and recorded permanently in the activity feed. The friction is the feature: the override exists so the cage never has to be *dismantled* in an emergency, and the delay exists because the cage protects the operator from himself too.

## The dashboard

Five views, one job each:

1. **Overview** — the five-second answer. Total equity and its curve (dry-run and live clearly distinguished), each sleeve's state and allocation in one row, any active halt or override, system health (data freshness, last engine tick, exchange connectivity), and the top of the activity feed.
2. **Sleeves** — a living page per sleeve, the heart of the observatory: its mandate and state, equity curve, open positions with stops and unrealized P&L, and a real-time picture of what the sleeve is doing *now* — the last tick, the current strategy read on each pair, the regime assessment in force with its rationale, distance to each cage limit, and the countdown to its next action. Below the live picture, its full decision history and its trial report when one is pending. Watching a sleeve think should be engaging enough that checking on it is something the operator wants to do, not has to.
3. **Activity** — the append-only feed of everything that matters: entries, exits, rejected order intents *with the cage's reasons*, regime changes, halts, promotions and demotions, overrides, reconciliation results, errors. Filterable by sleeve and severity. This feed is the product's replacement for notifications, and its completeness is a guarantee, not an aspiration.
4. **Money** — the insight arms' home. Spending analysis from imported bank data: where money goes by category and month, trends, recurring charges, anomalies, and concrete savings suggestions. Portfolio-wide view across all sleeves plus imported account balances — the whole financial picture in one place.
5. **Reports** — the library of generated documents: weekly per-sleeve and portfolio reviews written by AI from the recorded data (what worked, what didn't, whether live tracks expectation, whether the regime layer is earning its keep against a no-AI control), monthly spending reports, and every trial report ever produced. Reports recommend; they never act.

## The insight arms (v1: CommBank import)

The first shippable value in Ironcage moves no money at all. The operator exports transactions from CommBank NetBank — which supports CSV, OFX, and QIF export with two years of transaction history available — and drops the file into the dashboard. Ironcage parses, deduplicates, and categorizes them (AI-assisted categorization, correctable by the operator, and it learns the corrections), then powers the Money view and monthly spending reports.

Automatic bank sync via Australia's Consumer Data Right is explicitly *not* in v1: CDR access requires going through an accredited provider, which brings third-party dependencies and setup cost before first value. File import ships now; a CDR upgrade is a named candidate for later, to be adopted only if the manual export becomes the system's limiting annoyance.

## Guarantees, as the operator experiences them

- **Nothing is hidden.** Every order intent — including every rejection — appears in the activity feed with the cage's full verdict. A rejection is the system working, and it is displayed as such, never buried.
- **Numbers reconcile.** Positions and equity are recomputed from the recorded order history, and live sleeves are reconciled against the exchange on schedule. A discrepancy halts the sleeve and appears at the top of Overview. The dashboard never quietly papers over a mismatch.
- **Every AI output is traceable.** From any regime assessment, categorization, or report, the operator can open the full record: what the model was asked, what data it saw, what it answered, and when. AI outputs that fail validation are recorded failures, never silent guesses.
- **History is permanent.** Sleeves, trades, decisions, overrides, and reports are never deleted — retirement archives, it does not erase.

## The roadmap

Capability arrives as a ladder; each milestone is independently useful and honest on its own:

- **M1 — The ledger and the Money view.** Bank import, categorization, spending analysis, portfolio overview. Zero execution risk; useful in week one.
- **M2 — The engine and the first sleeve, dry.** Market data collection, the blotter, the fill simulator, the cage, and the first systematic crypto sleeve (Level 1 mandate, trend-following on major pairs) running in dry run. Dashboard grows Sleeves and Activity views.
- **M3 — The AI layer.** Regime assessments feeding the Level 1 sleeve, run beside a no-AI control; weekly reviews and trial reports. The AI layer must prove it earns its keep before anything scales.
- **M4 — First live capital.** The exchange gateway; the crypto sleeve promoted to a small live trial allocation on the operator's decision, on the evidence of its trial report.
- **M5 — Stocks.** A second market: broker integration (Interactive Brokers or equivalent), a stocks/ETF sleeve — including the long-term wealth sleeve at Level 0 — through the same dry-run-first lifecycle.
- **M6 — Experimental sleeves.** Level 2 (Piloted) mandates with permanent small caps; faster-cadence experiments. The laboratory opens only once the house is proven.

Ordering is a commitment; dates are not.

## Out of scope

No multi-user anything, no accounts, no sharing. No leverage, shorting, or derivatives — reversing any of these requires a deliberate future decision with its own written reasoning, not a config change. No sub-minute trading in any sleeve. No mobile app; the dashboard is responsive and that is enough. No automatic bank credentials handling outside a proper CDR arrangement. No strategy the operator cannot explain in a paragraph. And nothing that weakens a guarantee in this document — a feature idea that requires doing so is, by that fact, wrong.

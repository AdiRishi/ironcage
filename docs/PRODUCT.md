# Ironcage — Product Specification

The [vision](./VISION.md) says why Ironcage exists and the principles that bind it. This specification says what the system does. It refines the vision freely on specifics, but the vision's principles bind it: a specified behavior that weakens one is wrong by that fact. Any other disagreement between the two means one document is stale. That is a defect to resolve deliberately, not a contest either side wins by default. The test of these documents: a stranger should be able to read them and tell whether any behavior of the built system is correct or a bug, without reading code.

This file is the map. Each part of the product has its own document in [`docs/product/`](./product/) — read them in order:

1. [**Overview**](./product/01-overview.md) — the five-second answer to "is everything okay?"
2. [**Sleeves**](./product/02-sleeves.md) — the central object: the roster, mandates, the AI capability system, the lifecycle, and the per-sleeve living view.
3. [**Activity**](./product/03-activity.md) — the append-only record of everything that matters, the trade story, and the AI decision record.
4. [**Portfolio**](./product/04-portfolio.md) — the whole of wealth and the allocator's home: net worth, the capital ledger, allocation acts, the current book, costs, and the system cage.
5. [**Money**](./product/05-money.md) — bank import, categorization, and spending analysis.
6. [**Reports**](./product/06-reports.md) — the documents the system writes: reviews, trial reports, spending reports, incident reports.
7. [**Operations & control**](./product/07-operations.md) — the decision ceremony, modes, halts, the operator's controls, the break-glass override, and reconciliation.
8. [**The Workbench**](./product/08-workbench.md) — historical data, reproducible backtests, the trial count, and gate/shadow runs.
9. [**Tax**](./product/09-tax.md) — the holistic in-house tax engine: every exchange, wallet, broker, and bank source reconciled under Australian rules into the financial-year report.

## Product shape

Ironcage is two things that meet in the middle: an **engine** that runs continuously and needs no one watching, and a **web application** that makes watching it worthwhile. The web app is not an admin panel bolted onto a bot. It is a first-class product and half the joy of the system. Every sleeve, every read-only surface, every moving part gets its own living view: what it is doing right now, what it decided and why, how it is performing — presented with the care of something built to be _looked at_, not just checked. The design ambition is an observatory, not a control panel: data-dense, live, legible, and genuinely fun to watch.

The web app is the only surface: the operator visits it, it never interrupts them. Its defining obligation follows: **opening it must answer "is everything okay?" within five seconds**, and the activity feed must make it impossible for anything important to have happened silently. If an event matters, it is in the feed; if it is unseen, the app says so.

There is exactly one operator. Every screen is built for that one person's trust and pleasure, not for a customer's.

### The shell

A handful of elements are present on every screen, because the guarantees they carry must survive navigation:

- The **system mode** (Running / Halted) and the **halt-all control** — the system-wide stop is one click from anywhere.
- The **unacknowledged-critical count**, leading to the attention items on [Overview](./product/01-overview.md).
- The **override banner** — an armed or active break-glass override, with its scope and expiry, whenever one exists.
- The **connection indicator** — the app losing its backend link is a visible degraded state; dead data never renders as live.
- The **mode discipline** — dry-run and live data are tagged end-to-end and styled distinctly; no screen may conflate them.

### The one interruption

The app never pushes — with a single deliberate exception, recorded here as a decision: a **system-level halt**, or a **critical event while real positions are open**, sends the operator a terse external notification ("Ironcage needs you") that carries no data and offers no actions. Everything else waits in the feed. The exception exists because a machine holding real money must be able to say it has stopped; the notification's emptiness exists so the web app remains the only surface for information and control.

## The core loop

1. **The engine trades — or declines to.** Each sleeve acts on its own cadence per its mandate: evaluating its strategy, applying whatever AI capabilities its mandate holds (run-time capabilities can only throttle — except the one quarantined trade-proposer class, whose every proposal deterministic rules check individually; everything else is a design-time proposal or a report), passing every intent through the cage. Most ticks correctly do nothing.
2. **The operator visits.** Overview answers whether everything is okay; the Activity feed accounts for everything that happened; each sleeve's living view shows what it is doing and why.
3. **The operator adjudicates.** Trial reports arrive when sleeves seek promotion; weekly reviews and spending reports arrive on schedule. The system recommends; the operator decides through the decision ceremony ([Operations](./product/07-operations.md)); every decision is recorded beside its evidence.
4. **The operator feeds it.** Bank exports imported into the Money view keep the Money and Portfolio pictures current, and transfer requests ([Portfolio](./product/04-portfolio.md)) are fulfilled by moving money at the bank or venue — the system computes what to move and detects arrivals; only the operator's hands touch the money.

## Guarantees, as the operator experiences them

- **Nothing is hidden.** Every order intent — including every rejection — appears in the activity feed with the cage's full verdict. A rejection is the system working, and is displayed as such, never buried.
- **Numbers reconcile.** Positions and equity are recomputed from the recorded order history, and live sleeves are reconciled against the venue on schedule. A discrepancy halts the sleeve and is surfaced immediately on Overview. The app never quietly papers over a mismatch.
- **Every AI output is traceable.** From any regime assessment, categorization, or report, the operator can open its permanent decision record: what the model was asked, what it decided, why, what it cost, and when — with a link into the platform's full trace for as long as the platform retains it. AI outputs that fail validation are recorded failures, never silent guesses.
- **Decisions are informed.** Every decision of consequence — promotion, mandate change, allocation act, un-halt — happens through the decision ceremony: the evidence presented and recorded as presented, the change stated plainly, the reason written where risk increases, the decision stored permanently beside its evidence.
- **The system never moves money.** Venue keys cannot withdraw and no funding path exists anywhere in the system — every physical transfer is the operator's own act. The product computes what to move, requests it, detects the arrival, and settles the record ([Portfolio](./product/04-portfolio.md)); it choreographs money movement and can never perform it.
- **History is permanent.** Sleeves, trades, decisions, overrides, and reports are never deleted — retirement archives, it does not erase.

## Out of scope

No multi-user anything, no accounts beyond the operator, no sharing. No sub-minute trading in any sleeve. No mobile app; the web app is responsive and that is enough. No bank credentials handling outside a proper CDR arrangement. No strategy the operator cannot explain in a paragraph.

The system's venues are **Kraken (crypto) and Alpaca (US stocks/ETFs)** by deliberate consolidation — two clean, API-first integrations rather than many. **ASX access is deferred, not rejected**: the only programmatic doors for Australians (Interactive Brokers, Tiger) carry real operational cost for little gain at this scale, and US-listed ETFs serve the long-term wealth sleeve well; a future mandate may reopen the question with its own recorded decision.

On leverage, shorting, and derivatives, the boundary is drawn by feasibility and regulation, not squeamishness. **Equity-side shorting, options, and modest leverage are legitimate future sleeve mandates** (Alpaca itself supports US options; Interactive Brokers would add more), and a sleeve mandate proposing them goes through the same written-mandate, dry-run-first lifecycle as anything else — plus its own recorded decision, since each adds a new class of risk (unlimited downside on shorts, assignment on options, financing costs on leverage). **Crypto derivatives — margin, perpetuals, futures — stay out of scope**: Australian regulators have shut down or penalized the domestic retail offerings (Kraken's $8M penalty, Binance Australia Derivatives' $10M penalty), and the offshore alternatives sit in a regulatory grey zone with the worst blow-up profile in this document. The first sleeves are spot, long-only.

And nothing that weakens a guarantee in this specification. A feature idea that requires doing so is, by that fact, wrong.

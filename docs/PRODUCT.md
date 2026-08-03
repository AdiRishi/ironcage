# Ironcage — Product Specification

The [vision](./VISION.md) says why Ironcage exists and the principles that bind it. This specification says what the system does. Where the two conflict, the vision wins and this specification is wrong. The test of these documents: a stranger should be able to read them and tell whether any behavior of the built system is correct or a bug, without reading code.

This file is the map. Each part of the product has its own document in [`docs/product/`](./product/) — read them in order:

1. [**The Overview view**](./product/01-overview.md) — the five-second answer to "is everything okay?"
2. [**Sleeves**](./product/02-sleeves.md) — the central object: mandates, the AI grant system, the lifecycle, and the per-sleeve living view.
3. [**The Activity feed**](./product/03-activity.md) — the append-only record of everything that matters, and the completeness guarantee behind it.
4. [**The Money view**](./product/04-money.md) — bank import, spending analysis, and the whole-of-wealth portfolio picture.
5. [**Reports**](./product/05-reports.md) — the documents the system writes: reviews, trial reports, spending reports, incident reports.
6. [**Operations & control**](./product/06-operations.md) — modes, halts, the operator's controls, the break-glass override, and reconciliation.
7. [**Capital & the allocator**](./product/07-capital.md) — the capital ledger, deposits and withdrawals, allocation acts, and the system cage.
8. [**The Workbench**](./product/08-workbench.md) — historical data, reproducible backtests, the multiplicity ledger, and gate/shadow runs.

## Product shape

Ironcage is two things that meet in the middle: an **engine** that runs continuously and needs no one watching, and a **web application** that makes watching it worthwhile. The web app is not an admin panel bolted onto a bot — it is a first-class product and half the joy of the system. Every sleeve, every insight arm, every moving part gets its own living view: what it is doing right now, what it decided and why, how it is performing — presented with the care of something built to be *looked at*, not just checked. The design ambition is an observatory, not a control panel: data-dense, live, legible, and genuinely fun to watch.

The web app is also the only surface: the operator visits it, it never interrupts them. Its defining obligation follows: **opening it must answer "is everything okay?" within five seconds**, and the activity feed must make it impossible for anything important to have happened silently. If an event matters, it is in the feed; if it is unseen, the app says so.

There is exactly one operator. Every screen is built for that one person's trust and pleasure, not for a customer's.

## The core loop

1. **The engine trades — or declines to.** Each sleeve acts on its own cadence per its mandate: evaluating its strategy, applying whatever AI grants its mandate holds (run-time grants can only attenuate; everything else is a proposal or a report), passing every intent through the cage. Most ticks correctly do nothing.
2. **The operator visits.** Overview answers whether everything is okay; the Activity feed accounts for everything that happened; each sleeve's living view shows what it is doing and why.
3. **The operator adjudicates.** Trial reports arrive when sleeves seek promotion; weekly reviews and spending reports arrive on schedule. The system recommends; the operator decides; every decision is recorded.
4. **The operator feeds it.** Bank exports imported into the Money view keep the whole-of-wealth picture current.

## Guarantees, as the operator experiences them

- **Nothing is hidden.** Every order intent — including every rejection — appears in the activity feed with the cage's full verdict. A rejection is the system working, and is displayed as such, never buried.
- **Numbers reconcile.** Positions and equity are recomputed from the recorded order history, and live sleeves are reconciled against the venue on schedule. A discrepancy halts the sleeve and is surfaced immediately on Overview. The app never quietly papers over a mismatch.
- **Every AI output is traceable.** From any regime assessment, categorization, or report, the operator can open the full record: what the model was asked, what data it saw, what it answered, and when. AI outputs that fail validation are recorded failures, never silent guesses.
- **History is permanent.** Sleeves, trades, decisions, overrides, and reports are never deleted — retirement archives, it does not erase.

## Out of scope

No multi-user anything, no accounts beyond the operator, no sharing. No sub-minute trading in any sleeve. No mobile app; the web app is responsive and that is enough. No bank credentials handling outside a proper CDR arrangement. No strategy the operator cannot explain in a paragraph.

The system's venues are **Kraken (crypto) and Alpaca (US stocks/ETFs)** by deliberate consolidation — two clean, API-first integrations rather than many. **ASX access is deferred, not rejected**: the only programmatic doors for Australians (Interactive Brokers, Tiger) carry real operational cost for little gain at this scale, and US-listed ETFs serve the long-term wealth sleeve well; a future mandate may reopen the question with its own recorded decision.

On leverage, shorting, and derivatives, the boundary is drawn by feasibility and regulation, not squeamishness. **Equity-side shorting, options, and modest leverage are legitimate future sleeve mandates** (Alpaca itself supports US options; Interactive Brokers would add more), and a sleeve mandate proposing them goes through the same written-mandate, dry-run-first lifecycle as anything else — plus its own recorded decision, since each adds a new class of risk (unlimited downside on shorts, assignment on options, financing costs on leverage). **Crypto derivatives — margin, perpetuals, futures — stay out of scope**: Australian regulators have shut down or penalized the domestic retail offerings (Kraken's $8M penalty, Binance Australia Derivatives' $10M penalty), and the offshore alternatives sit in a regulatory grey zone with the worst blow-up profile in this document. The first sleeves are spot, long-only.

And nothing that weakens a guarantee in this specification — a feature idea that requires doing so is, by that fact, wrong.

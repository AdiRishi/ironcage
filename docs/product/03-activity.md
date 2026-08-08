# Activity

The feed is the append-only record of everything that matters, and the product's substitute for interruptions: the system never pushes (save the one recorded exception in [PRODUCT.md](../PRODUCT.md)), so the feed must make it impossible for anything important to have happened silently. Its completeness is a guarantee, not an aspiration — every order intent, verdict, fill, halt, transition, and failure produces exactly one feed event. If it isn't in the feed, it didn't happen; if it happened and isn't in the feed, that is a bug by definition.

This document also specifies the two lenses built on top of the raw record: the **trade story**, which renders one trade's events as a narrative, and the **decision record**, which opens any AI output to its permanent record.

## The event record

Every event carries:

- **Timestamp** (and the candle/tick it belongs to, where applicable)
- **Origin** — a sleeve, a read-only surface (Money, Tax), or the system itself
- **Category and type** (taxonomy below)
- **Severity** — `info`, `notice`, `warning`, `critical`
- **Summary** — one plain-language line, readable without context
- **Payload** — the full structured record behind the summary: the complete cage verdict, the order details, the diff, the error. One click from summary to everything.
- **Links** — to the trade story, the report, the mandate version, or the decision record the event relates to.

Events are immutable and kept forever. There is no editing and no deleting.

## Taxonomy

**Trading** — intent emitted; intent rejected (with the cage's full verdict — every violated rule, not just the first); order placed / partially filled / filled / canceled / replaced; position opened / closed (with realized P&L and costs); stop updated.

**Capabilities & signals** — a capability's output changed materially (a regime-assessment axis moved, with old → new and rationale; event veto placed or expired; risk-officer tightening applied or lapsed); a capability's output went stale (the consuming behavior now at its most restrictive default); a capability suspended or reinstated by its scorecard; a design-time proposal submitted, passed or failed a gate, approved, or rejected; a Piloted sleeve's trade proposal and its outcome (accepted into an intent, or rejected — with the full check result and decision-record link); a strategy signal that produced an intent. (Routine no-change ticks are recorded as engine telemetry, not feed events — the feed is for what matters, not a heartbeat log.)

**Risk** — a limit approached (configurable warning threshold, e.g. 80% of daily loss); a halt triggered (which rule, at what value); pair/instrument lock created or expired; system-cage event (total exposure or drawdown breach; an entry refused by the system cage is recorded once — as its intent's rejection in Trading, carrying the system-cage reason); reconciliation mismatch detected.

**Lifecycle** — sleeve created; mandate changed (with diff and recorded reasoning); state transition, pause, or resume (who/what triggered it); promotion or demotion (with trial report link); override armed / became active / used / expired; sleeve retired.

**Capital** — deposit, withdrawal, or inter-venue transfer recorded (pending) or settled on detection; transfer request issued, fulfilled, or dismissed (with what the dismissal cancelled or accepted); a pending transfer flagged (missed window, or arrived at a different amount); an unmatched venue balance change awaiting the operator's claim; allocation act (fund / reduce / return, with the evidence shown at decision time — a fund act awaiting funding, and its activation on arrival); drawdown-to-target entered or completed.

**System** — market data gap (and which sleeves stood down because of it); historical data backfill performed (range, source); venue or gateway connectivity lost/restored; AI run failed (regime tick, categorization, report generation — validation failures included); report generated (or generation failed); deploy completed (with the code version).

**Money** — bank import completed (n transactions, m new, k needing category review); recurring charge detected or changed price; spending anomaly detected; tax source synced (events added, coverage change); tax gap detected or closed; missing cost basis flagged or resolved; tax-source balance mismatch; FY tax report generated.

## Severity semantics

- **info** — the system doing its job (fills, imports, routine transitions).
- **notice** — worth a glance (regime-assessment changes, mandate changes, rejected intents).
- **warning** — something degraded or approaching a limit (stale data, failed AI run, 80% of a loss limit).
- **critical** — something stopped or is wrong (halts, reconciliation mismatches, connectivity loss with positions open, every override event).

**Critical events require acknowledgment.** They persist in Overview's attention row until the operator explicitly acknowledges them, and acknowledgment is itself recorded. Nothing else in the product nags; this does, by design.

## Reading the feed

The full feed view supports filtering by origin (sleeve / read-only surface / system), category, severity, and time range, plus full-text search over summaries. Each sleeve's living view embeds its own pre-filtered slice. Events produced by one logical action (an entry's intent → order → fill chain) are associated with each other so they can be understood as a unit, and the count of unacknowledged critical events is available from anywhere in the app.

## The trade story

The association between one action's events is not just a grouping — it renders as a view: **any trade, fully explained, on one screen.** A trade story tells, in order: the strategy signal that started it; each capability's contribution to the size (the regime assessment's axes and rationale, any veto or tightening in force — each opening its decision record); the cage's verdict with every rule it checked; the order's venue lifecycle; every fill with its fees; the stop's placement and every move it made; the exit and what triggered it; and the realized P&L, net of the costs itemized along the way. Simulated fills are marked as simulated, degraded fills as degraded — the story carries the same honesty tags as everything else.

The trade story opens from any of its events in the feed, from a sleeve's Positions and Decisions sections, and from any report that cites the trade. It is the observatory's atomic unit of comprehension: if the operator can read one trade's story and understand every step, the product's auditability guarantee is real; if any step is unexplained, that is a bug in this view.

## The decision record

Every AI output in the product — a capability tick, a transaction categorization, a generated report — opens its **decision record**: the permanent account of that one decision. It records what the model was asked, at decision grain; what it decided; the stated rationale; the model and configuration used; the cost; and the timing. One click from any AI-attributed value, anywhere in the app, to this record. Failed validations produce decision records too — a rejected output's record shows exactly what was refused and why, which is how "recorded failures, never silent guesses" is made inspectable.

Each decision record also links into AI Gateway's full trace — the exact prompt, the context the model saw, the raw response — for as long as the platform retains it (7–30 days). The decision record is permanent; the full trace is a window that closes.

The decision record is the guarantee "every AI output is traceable" made concrete: it is reachable from every surface that displays an AI output, and a displayed AI output with no path to its decision record is, by that fact, a defect.

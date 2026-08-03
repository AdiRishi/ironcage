# The Activity feed

The feed is the append-only record of everything that matters, and the product's substitute for interruptions: the system never pushes, so the feed must make it impossible for anything important to have happened silently. Its completeness is a guarantee, not an aspiration — every order intent, verdict, fill, halt, transition, and failure produces exactly one feed event. If it isn't in the feed, it didn't happen; if it happened and isn't in the feed, that is a bug by definition.

## The event record

Every event carries:

- **Timestamp** (and the candle/tick it belongs to, where applicable)
- **Origin** — a sleeve, an insight arm, or the system itself
- **Category and type** (taxonomy below)
- **Severity** — `info`, `notice`, `warning`, `critical`
- **Summary** — one plain-language line, readable without context
- **Payload** — the full structured record behind the summary: the complete cage verdict, the order details, the diff, the error. One click from summary to everything.
- **Links** — to the trade, the report, the mandate version, or the AI tick snapshot the event relates to.

Events are immutable and kept forever. There is no editing and no deleting.

## Taxonomy

**Trading** — intent emitted; intent rejected (with the cage's full verdict — every violated rule, not just the first); order placed / partially filled / filled / canceled / replaced; position opened / closed (with realized P&L and costs); stop updated.

**Grants & signals** — a grant's output changed materially (regime vector axis moved, with old → new and rationale; event veto placed or expired; risk-officer tightening applied or lapsed); a grant's output went stale (the consuming behavior now at its most restrictive default); a grant suspended or reinstated by its value-added ledger; a design-time proposal submitted, passed or failed a gate, approved, or rejected; a strategy signal that produced an intent. (Routine no-change ticks are recorded as engine telemetry, not feed events — the feed is for what matters, not a heartbeat log.)

**Risk** — a limit approached (configurable warning threshold, e.g. 80% of daily loss); a halt triggered (which rule, at what value); pair/instrument lock created or expired; system-cage event (total exposure or drawdown); reconciliation mismatch detected.

**Lifecycle** — sleeve created; mandate changed (with diff and recorded reasoning); state transition (who/what triggered it); promotion or demotion (with trial report link); override armed / became active / used / expired; sleeve retired.

**Capital** — deposit or withdrawal (amount, venue, note); allocation act (fund / reduce / return, with the evidence shown at decision time); drawdown-to-target entered or completed; a system-cage rejection of an entry (which limit, at what value).

**System** — market data gap (and which sleeves stood down because of it); historical data backfill performed (range, source); venue or gateway connectivity lost/restored; AI run failed (regime tick, categorization, report generation — validation failures included); import processed.

**Money** — bank import completed (n transactions, m new, k needing category review); recurring charge detected or changed price; spending anomaly detected.

## Severity semantics

- **info** — the system doing its job (fills, imports, routine transitions).
- **notice** — worth a glance (regime changes, mandate changes, rejected intents).
- **warning** — something degraded or approaching a limit (stale data, failed AI run, 80% of a loss limit).
- **critical** — something stopped or is wrong (halts, reconciliation mismatches, connectivity loss with positions open, every override event).

**Critical events require acknowledgment.** They persist in Overview's attention row until the operator explicitly acknowledges them, and acknowledgment is itself recorded. Nothing else in the product nags; this does, by design.

## Reading the feed

The full feed view supports filtering by origin (sleeve/arm/system), category, severity, and time range, plus full-text search over summaries. Each sleeve's living view embeds its own pre-filtered slice. Events produced by one logical action (an entry's intent → order → fill chain) are associated with each other so they can be understood as a unit, and the count of unacknowledged critical events is available from anywhere in the app.

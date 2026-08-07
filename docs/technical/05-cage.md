# Cage

The cage is the deterministic risk layer no AI output can reach — the heart of the project, per the vision. This chapter specifies it as code: where it runs, the exact semantics of each sleeve-cage rule, the clamp, the system cage's reservation protocol, halts, and the break-glass override. Everything here is boring on purpose; the cage's entire value is that nothing about it is clever.

## Where the cage lives

**Rule evaluation is pure code in `packages/engine`** — a function from (mandate limits, current sleeve state, proposed action) to a verdict. Purity is load-bearing twice over: the same evaluation runs identically in live trading, dry run, and backtests, and it is trivially property-testable. **Cage state** — the counters and marks the rules read — lives in the sleeve actor and is rebuildable from the blotter. **The system cage** is its own actor ([Topology](./02-topology.md)). No code in `ironcage-agents` can invoke, address, or configure any of it; the AI's only relationship to the cage is being clamped by it.

Cage configuration — a sleeve's limits — lives in the mandate, versioned, changed only through the ceremony, effective from the next tick, never mid-decision. **An unstated limit is a validation error at mandate authoring, not a default.** The system cage's configuration has the same discipline, with a stricter rule: no AI capability may even *propose* a change to it; only the operator authors one.

## The sleeve cage — rule semantics

Six rule families, in two behavioral classes: **entry checks** (evaluated when an intent is formed; failure rejects the intent) and **monitors** (evaluated on every tick and every fill; breach halts the sleeve). Every evaluation produces a verdict row naming each rule, its threshold, the observed value, and the distance to the limit — recorded whether or not anything proceeds, because "how much room is left" is a product-level display ([Sleeves](../product/02-sleeves.md)).

**Entry checks:**

- **Max position size per instrument.** The proposed entry's notional (post-clamp), plus any existing position and any in-flight entry on that instrument, must not exceed the mandate's per-instrument cap. Notional is quantity × current mark; the mark is the candle close the tick evaluated on.
- **Max concurrent positions.** Count of open positions plus in-flight entries across the sleeve, strictly below the cap before a new entry may form.
- **Trade-frequency cap.** Entries within the mandate's rolling window (e.g. per 24h) must be under the cap. Counted from intent creation, not fills — a rejected intent does not consume budget, a placed-then-canceled one does; the cap bounds *attempts to act*, not luck.

**Monitors:**

- **Daily loss halt.** The sleeve's realized P&L plus the mark-to-market change of its open positions, net of fees, measured from the sleeve's equity at the UTC day boundary. Falling past the mandate's threshold halts the sleeve. Evaluated at every tick and on every fill event — between those moments, venue-resident stops are the protection, which is why they exist ([Engine](./04-engine.md)).
- **Drawdown halt.** Sleeve equity against its own high-water mark (tracked from dry-run start, reset at promotion — dry-run drawdown history doesn't count against the live record, and vice versa). Falling past the threshold halts.
- **Stop-loss policy.** Not a check but an obligation: every position the mandate's policy covers must have a venue-resident stop working at all times. The monitor verifies the obligation — a position found without its stop (venue rejected it, it was canceled externally) is itself a breach: the sleeve halts, because the mandate's protection is not in force.

**Precision and honesty rules that bind all six:** computations use the blotter-derived state, never the venue's word alone (reconciliation audits the difference); all thresholds compare in the sleeve's accounting currency at recorded marks; and **an uncomputable rule is a failed rule** — if a mark is missing or a counter cannot be derived, the cage resolves as if the limit were breached: entry checks reject, monitors halt. The cage never gives the benefit of the doubt, because doubt is exactly what it exists to resolve.

## The clamp

The seam where capability outputs meet the strategy's desired posture, restated here as the cage's outer face ([Engine](./04-engine.md) step 6, [AI](./06-ai.md) for the producing side):

- A **multiplier** in [0,1] scales entry size down. Multiple multipliers compose by taking the minimum.
- A **lock** vetoes entries on its instruments outright until expiry.
- A **tightening** lowers a sleeve limit temporarily, always relative to the mandate's baseline (re-tightening replaces, never compounds), with an expiry.
- Composition is conservative by construction: adding capabilities can only make a sleeve more cautious. The identity `effective ≤ strategy-desired` is asserted in code after every clamp — a violated assertion is a defect that halts the sleeve, since it means the reduce-only property itself failed.
- **Exits and stops are untouchable.** No capability output reaches exit logic or stop management; the clamp applies to entries and entry sizing only.

## The system cage

Above every sleeve, one actor owns three whole-system limits ([Portfolio](../product/04-portfolio.md)). Its numbers are recomputed from the blotter at every reconciliation — the reservation ledger is a projection, audited like every other.

**Total exposure cap.** Deployed capital across live sleeves may not exceed the configured fraction of total system capital. Enforced by the **reservation protocol**:

1. **`reserve(sleeve, intent, amount)`** — called between the sleeve-cage verdict and intent execution. The actor answers atomically from its ledger: current exposure + open reservations + `amount` against the cap. Refusal rejects the intent with the system-cage reason on the verdict.
2. **`commit(intent, filled_amount)`** — on fill: the reservation becomes recognized exposure (at the filled amount; the difference is released).
3. **`release(intent)`** — on rejection, cancellation, or failure: headroom returns.
4. **Reservations expire.** Each carries a TTL comfortably above the venue actor's worst-case settlement; expiry releases automatically and flags the orphan for reconciliation. A crashed sleeve cannot leak headroom.
5. **Exposure decreases without ceremony** — exits reduce recognized exposure on their fills. Only increases pass through reservations; reductions must never be blockable, in the cage as everywhere.

**System drawdown kill switch.** Total live equity across all sleeves against its high-water mark, evaluated on every commit, every exit fill, and every reconciliation. Breach → system mode Halted: every sleeve actor is told immediately (and would discover it at its next tick regardless, [Topology](./02-topology.md)), each applies its own winddown policy, the incident report generates, the one interruption sends. Leaving system-Halted is a single operator act from that report.

**Venue concentration cap.** A placement limit, not an order-time check: capital at any single venue over total system capital. Orders don't move capital between venues, so this monitors continuously, flags at the moments that *do* move capital — allocation acts and transfer requests — and surfaces breached headroom on Portfolio until a transfer request or the operator's recorded acceptance resolves it.

## Halts, pause, and leaving them

Mechanics are specified in [Engine](./04-engine.md); the control rules live here:

- **Halts are automatic and unsentimental** — a monitor breach, a system-cage breach, or a reconciliation mismatch halts without asking. The halt's feed event names the rule and the value that fired it; the incident report reconstructs the timeline.
- **Un-halting is always the operator, always from the incident report**, through the ceremony — the product's rule that resuming without seeing the evidence is not a path the software offers is implemented by making the un-halt action exist only on the report's view.
- **Pause is not a halt**: an operator flag on the sleeve — no new entries, positions and stops still managed, no winddown. It gates the tick at step 2 without touching state.
- **Risk-reducing controls are never gated** ([Operations](../product/07-operations.md)): pause, flatten, halt-sleeve, halt-all execute immediately on operator command, bypassing every ceremony and every cage check — the cage constrains risk-increasing action only. Flatten submits real closing orders through the normal venue path (it is still an intent, still recorded; it just cannot be blocked).

## The break-glass override

The ceremony at its most severe ([Operations](../product/07-operations.md)), specified technically:

- **An override is a row**, not a mode: sleeve, the single named limit, the single action class permitted past it, armed-at, active-from (armed + 15-minute cooling-off), expires-at (active + 24h max), consumed-at. All transitions are `critical` feed events requiring acknowledgment; the shell banner renders from this row's existence.
- **Enforcement is a narrow carve-out in cage evaluation**: when the named rule fails for the named sleeve, and an active, unconsumed override matches this exact action class, the verdict records the rule as **overridden** (never as passed — the verdict shows the breach *and* the authorization), and consumption is written in the same transaction. One action; using it spends it.
- **Structural exclusions**, enforced by what the code consults: the system cage never reads overrides (they cannot exist for it), risk-reducing paths never read them (nothing there to override), and auditing is unconditional. An override affects exactly one future verdict of one sleeve, and nothing else in the system.

## What the cage never does

It never calls an agent, reads a model output directly (only validated, clamped capability rows), moves money, or loosens anything on its own. It has no admin surface: every configuration change arrives through a mandate version or a system-cage ceremony, and takes effect at the next tick. The cage's code path from "rule breached" to "sleeve halted" contains no branching on anyone's judgment — that absence is the product.

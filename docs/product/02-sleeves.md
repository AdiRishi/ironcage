# Sleeves

A sleeve is the product's central object: a bounded allocation of capital with its own rules of engagement. Creating, watching, and adjudicating sleeves _is_ using Ironcage. This document specifies the mandate, the AI grant system, the lifecycle, and the per-sleeve living view.

## The mandate

Every sleeve is defined by its mandate — versioned configuration, changed only through a deliberate, recorded act ([Operations](./06-operations.md)), never a live slider. A mandate states:

- **Name and purpose** — one paragraph a human can understand. A strategy the operator can't explain doesn't get a sleeve.
- **Market, venue, instruments** — e.g. spot BTC and ETH on Kraken; US-listed ETFs via Alpaca. Kraken and Alpaca are the system's two venues by deliberate consolidation; first sleeves are spot, long-only. The mandate vocabulary supports venues, sides, and instrument classes beyond these (ASX, shorts, options) so future mandates can propose them per the scope rules in [PRODUCT.md](../PRODUCT.md).
- **Strategy** — the systematic rules it runs, and the timeframe(s) they evaluate on.
- **Cadence** — how often it acts: from quarterly rebalancing to every 4-hour candle. Never sub-minute.
- **AI grants** — which grants from the registry this sleeve holds, with their per-sleeve parameters (below).
- **Capital cap** — the maximum the sleeve may ever hold, in dollars. The allocator may grant less; nothing grants more without a mandate change.
- **Risk limits** — the sleeve's own cage: max position size per instrument, max concurrent positions, stop-loss policy, daily loss halt, drawdown halt, trade-frequency cap.
- **Winddown policy** — what a halt does with open state: `flatten-all`, `keep-positions-cancel-orders`, or `keep-all`.
- **Benchmarks** — what this sleeve must beat to justify itself, declared up front (always including buy-and-hold of its own universe; for any sleeve with run-time grants, also its own no-AI control).

## AI grants

AI participation is not a single dial but a set of **grants**: typed capabilities a mandate holds, drawn from a system-wide, versioned **grant registry**. Each registry entry declares, once, what the grant consumes, the exact shape of its output, what deterministic component reads it, its cadence, its staleness window, its safe default, its audit record, its **control definition** (what the no-AI counterfactual is), and its **demotion rule**. A mandate then simply lists grants plus per-sleeve parameters.

Every grant belongs to exactly one of four **valve classes** — and the classes are closed: adding a fifth is a constitutional change with its own written decision, never a feature.

1. **Attenuator** (run-time). Output is deterministically clamped so it can only _reduce_ what the strategy and cage would otherwise permit: a [0,1] size multiplier, an added lock, a tightened limit. Missing, stale, or invalid output resolves to the most restrictive default. Attenuators compose conservatively — multiple grants combine by taking the most restrictive, so **adding grants can only make a sleeve more cautious, never less**. Worst case if the AI is wrong or fed hostile data: the sleeve behaves like its no-AI self, or stands down.
2. **Gated proposal** (design-time). Output is a _draft change to the machine_ — new parameter values, a strategy variant, a mandate diff — that lands in a proposal queue and must pass its declared gate pipeline before touching live behavior: schema validation → reproducible backtest → walk-forward evaluation (with multiplicity-corrected acceptance thresholds — the system assumes that an AI generating many candidates will produce impressive flukes) → champion/challenger dry-run shadowing → operator approval. A wholly wrong AI produces nothing worse than a bad proposal the gates exist to kill.
3. **Observer**. Read-only analysis: reviews, memos, calibration reports. Observers recommend; they never act. Zero execution risk.
4. **Trade proposer** (quarantined). The one non-reduce-only class: AI originates individual trades as typed intents that deterministic code checks against the mandate and cage, under a declared per-day proposal budget, with full prompt-trace auditing. Permanently small-capped, permanently experimental — the class exists so this configuration can be _studied_, never scaled.

**Grants follow evidence — the constitutional rule applies to AI itself.** Every run-time grant computes its counterfactual on every tick: what would the sleeve have done without this grant? The counterfactual runs through the same simulated-fill machinery as dry run, accruing a per-grant **value-added ledger** (P&L delta, drawdown delta, cost delta versus control) that is always visible on the sleeve's living view. The registry declares each grant's default demotion rule and a mandate may tighten it for its sleeve; a grant that underperforms its control past that rule is automatically **suspended** — output ignored, safe default applied, critical feed event, operator adjudicates. Design-time grants keep the analogous ledger over their proposals: submitted, passed gates, survived live, value added.

### Profiles (shorthand, not structure)

Named grant bundles exist purely as vocabulary: **Clockwork** = no grants (pure rules — the long-term wealth sleeve). **Advised** = the run-time attenuator bundle plus observers. **Assisted-design** = Advised plus gated-proposal grants. **Piloted** = includes the trade proposer. The living view always shows the actual grant list; the profile name is a summary, never the mechanism.

## The grant registry (initial catalog)

Run-time attenuators:

- **Regime vector.** The generalization of the original ON/HALF/OFF signal. On its cadence, AI emits — per instrument in the sleeve's universe — a small vector of named axes (e.g. trend quality, volatility state, liquidity, news risk), each on a quantized ladder (0, ¼, ½, ¾, 1) with per-axis rationale and cited sources. A deterministic combiner declared in the mandate (default: the minimum across axes) collapses it to one entry-size multiplier per instrument. An instrument at 0 simply doesn't enter. Stale or invalid → 0. ON/HALF/OFF is the one-axis, three-rung special case.
- **Event veto.** AI reads economic calendars, exchange status, and news, and writes time-boxed locks ("no BTC entries from 6h before FOMC to 2h after", "venue X degraded — lock all its instruments") with reason and source snapshot, bounded by mandate-declared maximum duration and count. AI can lock; only expiry or the operator unlocks — including locks it didn't create.
- **Risk-officer overlay.** Once daily, AI reviews the book adversarially — positions, distance to limits, news — and may apply _temporary tightenings_ of the sleeve's own limits (a lower daily-loss halt, a cap on the entry multiplier, an added lock), each with expiry, each relative to the mandate's baseline (no compounding ratchet). It can also recommend flattening — as a critical feed event for the operator's one-click controls, never as an action of its own. Exits and stops remain untouchable by every grant.

Gated proposals:

- **Parameter corridors.** The mandate pre-declares, per tunable strategy parameter, a corridor: minimum, maximum, maximum step per change, minimum interval between changes. AI analyzes performance and proposes new values inside the corridor with rationale and a reproducible backtest; the proposal passes the gate pipeline and becomes a new mandate version on approval. The operator signs the risk envelope once (the corridor), then adjudicates moves within it; small pre-signed sub-corridors may later auto-approve.
- **Strategy variants.** AI drafts new or modified strategy rules as a challenger: a Draft sleeve with an auto-generated mandate, entering the standard lifecycle — dry run, trial report against the incumbent, promotion or death. The AI is a prolific proposer of tenants; capital-follows-evidence is the killing floor. Concurrent trials are capped so multiplicity can't launder a lucky variant into capital.

Observers:

- **Calibration audit.** Periodically analyzes which limits never bind (meaninglessly loose?), which bind constantly (too tight — or the cage is doing the strategy's job), stops versus realized volatility, and recommends mandate diffs. Any loosening goes through the normal operator mandate-change act.
- **Allocation memo.** Reviews all sleeves' evidence, correlation, and conditions; writes the memo the operator reads before allocator decisions. Recommend-only.
- **Red-team scenarios.** AI authors adversarial what-ifs as typed shock specifications (gap-downs, venue outages, depegs, historical replays); a deterministic scenario engine replays them against the current book and reports which limits fire, in what order, and whether winddown behaves. Findings feed calibration and risk-officer tightenings.

Trade proposer:

- **Piloted trading.** As specified above: typed proposals, cage-checked, budget-capped, permanently small, heaviest audit load.

The registry grows by adding entries within these classes — each addition a recorded, versioned act with its control and demotion rule defined before first use.

## The lifecycle

**Draft → Dry run → Live → Halted / Retired**

| State   | Meaning                                                                                                                 | Entered by                                                        |
| ------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Draft   | Mandate written; nothing runs                                                                                           | Operator creates sleeve (or a strategy-variant grant proposes it) |
| Dry run | Trades simulated money against live markets through the same code path as live, with realistic simulated fills and fees | Operator starts it                                                |
| Live    | Real money within the mandate's cap                                                                                     | Operator promotes it                                              |
| Halted  | Stopped; winddown policy applied; no new entries                                                                        | Cage (automatic) or operator                                      |
| Retired | Closed; capital returned; record kept forever                                                                           | Operator                                                          |

Every transition is a feed event recording who or what triggered it and why.

**Promotion is the operator's decision — informed, never forced.** The default recommendation is three months of dry run before first live capital, but the operator can promote or demote any sleeve at any time. The product's guarantee is _informed consent_: promotion happens from a **trial report** ([Reports](./05-reports.md)) — performance against the mandate's declared benchmarks, drawdown, costs, behavior conformance, and the value-added ledger of every grant it holds — and the report, the timing, and the decision are permanently recorded. The system never blocks an allocation choice; it makes every one explicit and impossible to misremember.

**Halts are automatic.** Breaching the sleeve's daily loss or drawdown limits, a reconciliation mismatch, or a system-cage breach halts the sleeve without asking. A halt applies the mandate's winddown policy — with one exception: a reconciliation-mismatch halt always freezes (`keep-all`) regardless of policy, because the system never trades on numbers in dispute. Leaving Halted is always an operator action, from the halt's incident report.

Two orthogonal notes. Any running sleeve may be **paused** — an operator flag, not a lifecycle state: no new entries while existing positions and stops continue to be managed, visibly flagged everywhere the sleeve appears. And demotion (Live → Dry run) is an ordinary operator transition, recorded exactly like promotion.

## Capital accounting

Sleeves may share a venue account, but every position, order, and dollar is tagged to exactly one sleeve; per-sleeve equity, P&L, and cost accounting are exact, not estimates. Above all sleeves sits the system cage: total exposure and total drawdown limits across the whole of Ironcage, enforced independently of any sleeve's own limits.

## The living view

One page per sleeve — the heart of the observatory. Watching a sleeve think should be engaging enough that checking on it is something the operator wants to do, not has to.

- **Now**: what the sleeve is doing at this moment. Its last tick and time to next action; the current strategy read per instrument; the effective entry multiplier per instrument and exactly how it was arrived at (each grant's current contribution — the regime vector's axes with rationale, active event vetoes with reasons, any risk-officer tightening in force); and the distance to each cage limit, so the operator sees not just that the sleeve is safe but _how much room it has_.
- **Grants**: every grant the mandate holds, with its current output, its staleness, its value-added-versus-control ledger over time, and its suspension state if demoted. For design-time grants: the proposal queue — pending proposals with their gate results so far, and the history of accepted and rejected ones.
- **Positions**: open positions with entry, current price, stop, unrealized P&L, and age; open orders with their lifecycle state.
- **Performance**: equity curve (dry/live distinguished), returns over standard windows, max drawdown, win rate, average win/loss, total fees and costs, and the benchmark overlays the mandate declared — including the no-AI control.
- **Decisions**: the sleeve-filtered activity feed — every intent with its cage verdict, every fill, every grant output change, in order.
- **Mandate**: the current mandate in full, plus its complete version history with diffs and the recorded reasoning for each change (including gate records for AI-proposed versions).
- **Trial report** (when pending): the report, presented with the promote/defer decision it exists to inform.

## The first sleeves

Two tenants are defined from the start; both go through the full lifecycle:

1. **Crypto trend** — Advised profile. Trend-following on BTC and ETH spot (Kraken), 4h–1d timeframes, volatility-scaled sizing. Initial grants: regime vector, event veto, calibration audit — each running against its control from the first dry-run day. The first sleeve to run end-to-end, and the proving ground for the whole engine.
2. **Long-term wealth** — Clockwork profile, no grants. Diversified US-listed ETF holdings via Alpaca, contribution-and-rebalance on a slow cadence, using fractional/notional orders so rebalancing is exact. Arrives when the Alpaca integration does; its mandate exists from day one so the allocator and portfolio views are built for it, not retrofitted. (Being US-domiciled holdings, this sleeve carries a W-8BEN and, at larger sizes, US estate-tax considerations — an accountant conversation belongs before it scales, and the mandate records that.)

Assisted-design grants (parameter corridors, strategy variants) and any Piloted sleeve are supported by the product from day one but expected to be adopted only once the first two tenants have proven the machine.

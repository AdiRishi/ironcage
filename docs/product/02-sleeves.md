# Sleeves

A sleeve is the product's central object: a bounded allocation of capital with its own rules of engagement. Creating, watching, and adjudicating sleeves *is* using Ironcage. This document specifies the mandate, the autonomy levels, the lifecycle, and the per-sleeve living view.

## The mandate

Every sleeve is defined by its mandate — versioned configuration, changed only through a deliberate, recorded act ([Operations](./06-operations.md)), never a live slider. A mandate states:

- **Name and purpose** — one paragraph a human can understand. A strategy the operator can't explain doesn't get a sleeve.
- **Market, venue, instruments** — e.g. spot BTC and ETH on Kraken; ASX/US ETFs via Interactive Brokers. First sleeves are spot, long-only; the mandate vocabulary supports sides and instrument classes beyond that (shorts, options) so future mandates can propose them per the scope rules in [PRODUCT.md](../PRODUCT.md).
- **Strategy** — the systematic rules it runs, and the timeframe(s) they evaluate on.
- **Cadence** — how often it acts: from quarterly rebalancing to every 4-hour candle. Never sub-minute.
- **Autonomy level** — L0, L1, or L2 (below).
- **Capital cap** — the maximum the sleeve may ever hold, in dollars. The allocator may grant less; nothing grants more without a mandate change.
- **Risk limits** — the sleeve's own cage: max position size per instrument, max concurrent positions, stop-loss policy, daily loss halt, drawdown halt, trade-frequency cap.
- **Winddown policy** — what a halt does with open state: `flatten-all` (exit everything at market), `keep-positions-cancel-orders`, or `keep-all`.
- **Benchmarks** — what this sleeve must beat to justify itself, declared up front (always including buy-and-hold of its own universe; for L1, also its own no-AI control).

## Autonomy levels

- **L0 — Clockwork.** Pure rules; no AI anywhere in the decision loop. (The long-term wealth sleeve lives here.)
- **L1 — Advised.** The default for trading sleeves. The deterministic strategy decides what and when. AI contributes exactly one input: a **regime assessment** — `ON`, `HALF`, or `OFF`, with confidence and rationale, produced on a schedule from multiple independent data sources. It acts purely as a position-size multiplier (1.0 / 0.5 / 0) on entries. It cannot initiate, cannot enlarge, and cannot touch exits or stops. An assessment past its declared staleness window — or missing, or failing validation — reads as OFF.
- **L2 — Piloted.** Experimental, permanently small-capped. AI proposes individual trades as typed, schema-validated intents; deterministic code checks every proposal against the mandate and the cage before anything proceeds. L2 mandates additionally declare a proposal budget (max proposals per day) and carry the heaviest audit load: every proposal — accepted or rejected — is recorded with its full prompt trace. L2 sleeves are instruments for learning, not scaling.

At every level, exits, stops, halts, and all risk-reducing actions are deterministic and cannot be blocked or delayed by AI output.

## The lifecycle

**Draft → Dry run → Live → Halted / Retired**

| State | Meaning | Entered by |
| --- | --- | --- |
| Draft | Mandate written; nothing runs | Operator creates sleeve |
| Dry run | Trades simulated money against live markets through the same code path as live, with realistic simulated fills and fees | Operator starts it |
| Live | Real money within the mandate's cap | Operator promotes it |
| Halted | Stopped; winddown policy applied; no new entries | Cage (automatic) or operator |
| Retired | Closed; capital returned; record kept forever | Operator |

Every transition is a feed event recording who or what triggered it and why.

**Promotion is the operator's decision — informed, never forced.** The default recommendation is three months of dry run before first live capital, but the operator can promote or demote any sleeve at any time. The product's guarantee is *informed consent*: promotion happens from a **trial report** ([Reports](./05-reports.md)) — performance against the mandate's declared benchmarks, drawdown, costs, and behavior conformance — and the report, the timing, and the decision are permanently recorded. The system never blocks an allocation choice; it makes every one explicit and impossible to misremember.

**Halts are automatic.** Breaching the sleeve's daily loss or drawdown limits, a reconciliation mismatch, or a system-cage breach halts the sleeve without asking. Leaving Halted is always an operator action, from the halt's incident report.

## Capital accounting

Sleeves may share a venue account, but every position, order, and dollar is tagged to exactly one sleeve; per-sleeve equity, P&L, and cost accounting are exact, not estimates. Above all sleeves sits the system cage: total exposure and total drawdown limits across the whole of Ironcage, enforced independently of any sleeve's own limits.

## The living view

One page per sleeve — the heart of the observatory. Watching a sleeve think should be engaging enough that checking on it is something the operator wants to do, not has to.

- **The Now panel** (top): what the sleeve is doing at this moment. Its last tick and next-action countdown; the current strategy read per instrument (e.g. "BTC: uptrend intact, above entry threshold; ETH: no signal"); for L1+, the regime assessment in force with rationale, source list, and age; distance-to-limit meters for each cage rule (position sizes, daily loss, drawdown, trade count) so the operator sees not just that the sleeve is safe but *how much room it has*.
- **Positions**: open positions with entry, current price, stop, unrealized P&L, and age; open orders with their lifecycle state.
- **Performance**: equity curve (dry/live distinguished), returns over standard windows, max drawdown, win rate, average win/loss, total fees and costs, and the benchmark overlay the mandate declared.
- **Decisions**: the sleeve-filtered activity feed — every intent with its cage verdict, every fill, every regime change, in order.
- **Mandate**: the current mandate in full, plus its complete version history with diffs and the recorded reasoning for each change.
- **Trial report** (when pending): the report and the promote/defer decision controls, front and center.

## The first sleeves

Two tenants are defined from the start; both go through the full lifecycle:

1. **Crypto trend** — L1 Advised. Trend-following on BTC and ETH spot (Kraken), 4h–1d timeframes, volatility-scaled sizing, regime-scaled exposure. The first sleeve to run end-to-end, and the proving ground for the whole engine.
2. **Long-term wealth** — L0 Clockwork. Diversified ETF holdings via Interactive Brokers, contribution-and-rebalance on a slow cadence. Arrives when broker integration does; its mandate exists from day one so the allocator and portfolio views are built for it, not retrofitted.

Experimental L2 sleeves are supported by the product from day one but expected to be defined only once the first two tenants have proven the machine.

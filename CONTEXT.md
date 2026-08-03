# Ironcage

Ironcage is a personal wealth operating system: one engine running many investment strategies, every one caged by deterministic risk rules, every one earning its capital through evidence. This glossary is the ubiquitous language of the domain; `docs/VISION.md` holds the vision, `docs/PRODUCT.md` the specification.

## Capital

**Sleeve**:
A bounded allocation of capital with its own mandate. The system's central object; sleeves are tenants of the engine.
_Avoid_: bot, strategy (for the capital unit), portfolio (for one sleeve), arm (reserved for insight arms)

**Mandate**:
A sleeve's versioned constitution: everything it may do, and under what limits.
_Avoid_: config, settings, profile (reserved for grant-bundle shorthand)

**Allocator**:
The discipline governing capital: total system capital equals unallocated cash plus sleeve allocations, and every allocation change is a recorded operator act.
_Avoid_: rebalancer, treasury

**Cage**:
The deterministic risk-limit layer no AI output can reach — per-sleeve limits plus the system cage (total exposure, system drawdown kill switch, venue concentration) above all sleeves.
_Avoid_: guardrails, safety layer, risk management (as a vague noun)

**Insight arm**:
A read-only part of the system — spending analysis, portfolio views, reports — that carries zero execution risk.
_Avoid_: sleeve (arms hold no capital), module, analytics (unqualified)

## AI grants

**Grant**:
One typed AI capability drawn from the versioned grant registry, held by a sleeve's mandate — or, for system-level observers, by the system itself.
_Avoid_: permission, feature, power

**Valve class**:
The safety shape of a grant — exactly four, closed forever: attenuator, gated proposal, observer, trade proposer.
_Avoid_: category, level, type (unqualified)

**Attenuator**:
A run-time grant whose output is deterministically clamped to reduce-only semantics: a [0,1] multiplier, an added lock, or a tightened limit.
_Avoid_: filter, modifier, signal booster

**Gated proposal**:
A design-time grant whose output is a draft change to the machine, inert until it passes the gate pipeline.
_Avoid_: suggestion, auto-update

**Regime vector**:
The flagship attenuator: per-instrument, multi-axis market assessments on a quantized ladder, collapsed by a deterministic combiner into an entry-size multiplier.
_Avoid_: prediction, forecast, trade signal

**Control**:
A grant's no-AI counterfactual: what the sleeve would have done without it, simulated through the same fill machinery.
_Avoid_: baseline (unqualified), benchmark (reserved for sleeve-level comparisons)

**Value-added ledger**:
A grant's running score versus its control — the evidence that decides whether the grant keeps its place.
_Avoid_: scorecard, rating

**Gate pipeline**:
The test gauntlet a proposal must survive before touching live behavior: validation, reproducible backtest, walk-forward, shadow run, operator approval.
_Avoid_: CI, review process

## Trading

**Order intent**:
A typed, idempotent request to change a position, emitted by the engine after strategy, grant, and cage evaluation.
_Avoid_: trade (before execution), order (before it reaches the venue)

**Blotter**:
The immutable, append-only record of orders and fills, from which all derived position state is recomputed.
_Avoid_: ledger (unqualified), journal

**Pair lock**:
A deterministic no-entry marker on an instrument (or everything) with a reason and an expiry.
_Avoid_: ban, freeze, blacklist

**Tick**:
One scheduled execution of a recurring process — an engine tick, a grant tick, or a housekeeping run. Decision-making ticks align to candle boundaries.
_Avoid_: cycle, iteration, heartbeat

## Proving

**Dry run**:
Running a sleeve against live markets with simulated fills through the same code path as live trading; the mandatory proving ground for every sleeve.
_Avoid_: paper trading (in docs and code), simulation (unqualified)

**Trial report**:
The evidence document a promotion decision is made from: performance against declared benchmarks, risk profile, costs, behavior conformance, and every grant's ledger.
_Avoid_: performance report (unqualified), review (reserved for weekly reports)

**Shadow run**:
A challenger configuration running in simulation beside the incumbent champion, on the same live data.
_Avoid_: A/B test, parallel run

**Workbench**:
The research surface: historical data coverage, reproducible cost-modeled backtests, the multiplicity ledger, and gate/shadow run visibility.
_Avoid_: lab, sandbox

**Multiplicity ledger**:
The visible count of trials behind any comparative result, so best-of-many is never mistaken for evidence.
_Avoid_: run counter

**Fail closed**:
The universal resolution of ambiguity: stale input, uncomputable state, or an unreachable venue always resolves toward not trading.
_Avoid_: fail safe (imprecise), graceful degradation

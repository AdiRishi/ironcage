# Ironcage

Ironcage is a personal automated trading system: an LLM brain bounded by a deterministic risk cage. This glossary is the ubiquitous language for the domain — see `docs/VISION.md` for the full vision.

## Language

**Regime signal**:
The LLM's only output that touches trading: a schema-validated verdict on current market conditions — `ON`, `HALF`, or `OFF` — plus confidence and rationale. It acts purely as a multiplier (1.0 / 0.5 / 0) on the position size the strategy would otherwise take; it can never initiate, enlarge, or extend anything. A signal older than its staleness window is treated as `OFF`.
_Avoid_: prediction, forecast, recommendation, trade signal

**Strategy signal**:
The deterministic entry/exit decision produced by rule-based code evaluating closed candles. Distinct from the regime signal: strategy decides _what and when_, regime scales _how much_.
_Avoid_: idea, call, setup

**Risk cage**:
The deterministic layer of hard limits the LLM has no write access to: per-position caps, concurrent-position caps, stop-losses, daily loss halt, drawdown kill switch, trade-frequency cap. Every order intent passes through it; when its inputs cannot be computed, it blocks (fail closed).
_Avoid_: guardrails, safety layer, risk management (as a vague noun)

**Order intent**:
A typed request to change a position, emitted by the engine after strategy + regime + cage evaluation. Intents are declarative and idempotent (client order id); only the execution pipeline turns them into exchange orders.
_Avoid_: trade, order (before it reaches the exchange), action

**Blotter**:
The immutable, append-only record of orders and their fills, and the trades derived from them. Derived values (average entry, amount, realized PnL, equity) are always recomputed from the full order history, never mutated in place.
_Avoid_: ledger, journal (that word is reserved for LLM tick records)

**Trade**:
One position lifecycle on one pair, from first entry fill to final exit fill, composed of one or more orders. Carries its stop, tags, and frozen exchange precision.
_Avoid_: position (use for the live exposure snapshot), deal

**Pair lock**:
A deterministic no-entry marker on a pair (or all pairs) with a reason and an expiry — the mechanism behind cooldowns, stoploss-guard, and drawdown halts. Checked before every entry; written after qualifying exits.
_Avoid_: ban, freeze, blacklist

**Dry run**:
Running the full system against live market data with simulated fills (order-book-aware) and a simulated wallet — the same code path as live trading with only the execution edge swapped. The mandatory proving ground before any real money.
_Avoid_: paper trading (in code and docs; acceptable colloquially), simulation, backtest (that's historical)

**Gateway**:
The thin, deliberately dumb service on a static-IP host that signs and forwards exchange REST calls. It enforces nothing and decides nothing; if it is down, nothing can trade — the correct failure mode.
_Avoid_: proxy (imprecise), broker, bridge

**Engine**:
The single-writer Durable Object that runs the trading loop: refresh data, evaluate strategy, read regime, apply the cage, emit intents, manage open orders. Exactly one instance; serialized execution makes double-ordering structurally impossible.
_Avoid_: bot (in code and docs), trader, agent

**Tick**:
One scheduled execution of the regime worker: assemble context → call the LLM → validate → persist signal + full audit snapshot. Ticks are candle-aligned, not wall-clock-naive.
_Avoid_: run, cycle, iteration

**Kill switch**:
The drawdown threshold whose breach flattens all positions, halts the engine, and requires manual restart. Two-tier: the daily loss halt pauses for 24h; the kill switch stops everything.
_Avoid_: circuit breaker, emergency stop

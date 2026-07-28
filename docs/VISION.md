# Ironcage — Vision

> **One-liner:** Ironcage is a personal automated trading system that uses an LLM for what it is demonstrably good at — synthesizing messy market context into a slow, bounded judgment — inside a deterministic cage of risk rules the AI can never override.

## The problem

Markets run 24/7; humans don't. The one structural advantage a retail individual can actually build is a system that watches continuously, never gets tired, and never revenge-trades. The obvious 2026-shaped idea — "let a frontier LLM trade for me" — has now been tested publicly with real money, and it fails: in the Alpha Arena live experiments, four of six frontier models lost 30–63% of their capital in under three weeks, and the winner won through low frequency and strict risk discipline, not intelligence. Long-horizon re-evaluations (FINSABER) showed the impressive LLM-agent backtests collapse under fair testing, and live contamination-free benchmarks (StockBench, Agent Market Arena) found that _framework and risk design_ drive outcomes far more than model choice.

Meanwhile the institutions best equipped to know — Bridgewater, Man Group, AQR — converged on the same shape: AI as a research and synthesis accelerant, with deterministic systems and human gatekeeping between the model and the money. Bridgewater's CIO calls LLM stock-picking "a hopeless path." Man Group lets agentic AI generate signals but never deploy them.

## The insight

The evidence does not say AI is useless for trading. It says the division of labor matters:

- **LLMs are strong at language-shaped judgment**: reading news flow, funding rates, and volatility structure and answering a slow, bounded question like "is this a regime a trend strategy should be trading?"
- **LLMs are weak and dangerous at execution**: they overtrade, burn fees, panic, and are fragile to perturbed inputs (TradeTrap) and even adversarially manipulated headlines.
- **Deterministic code is the opposite**: unbeatable at discipline, hopeless at reading the world.

Ironcage is the composition: **AI brain, iron cage.** The LLM's entire influence on trading is a single schema-validated multiplier — `ON`, `HALF`, or `OFF` — over what a boring, backtested, rules-based strategy would do anyway. The cage (position caps, stops, loss halts, kill switch, frequency limits) is code the LLM cannot reach. Every documented failure mode of autonomous LLM trading is structurally contained: it cannot overtrade (frequency cap), cannot panic-exit and re-enter (cooldown locks), cannot blow up on a poisoned headline (worst case: the multiplier drops to OFF), and cannot place an order at all (no execution path).

## What Ironcage is

A personal, single-operator system that:

1. **Trades a systematic strategy** — trend-following on a small set of liquid crypto pairs, on slow timeframes — chosen because momentum is one of the few effects with a century of out-of-sample evidence, and because slow means cheap.
2. **Lets an LLM scale exposure to conditions** — a regime tick every few hours, reading multiple independent data sources, emitting the bounded signal.
3. **Enforces risk deterministically** — the cage, pair locks, two-tier drawdown response, fail-closed on every missing input.
4. **Proves itself before it is trusted** — an honest dry-run mode (order-book-aware simulated fills, same code path as live) is the mandatory proving ground; live capital arrives only after months of clean evidence, and starts small.
5. **Audits everything** — every tick, signal, verdict, and order event is reconstructable from persisted state. If we can't debug why it traded, we don't have a trading system.

## Principles

1. **Fail closed.** Stale signal → OFF. Uncomputable risk state → blocked. Gateway down → nothing trades. Every ambiguity resolves toward not trading.
2. **The LLM can only subtract.** Its output multiplies the strategy's size by 1.0, 0.5, or 0 — never above 1.0, never a new position, never an override of an exit.
3. **Slow is a feature.** Fees and overtrading are the documented killer of automated retail systems. Every design choice biases toward trading less.
4. **Honest evaluation or nothing.** Walk-forward backtests against brutal baselines; a no-LLM control portfolio running beside the regime variant; live results judged on process before P&L. If the regime layer doesn't beat its control, it gets removed.
5. **The system is the asset.** At starting capital, realistic returns are pocket money; the durable value is a proven machine and the skills to build it. Scaling capital is downstream of evidence, never of excitement.
6. **The boring core stays boring.** Long-term wealth building belongs in diversified index investing outside this system. Ironcage is the strictly-capped satellite, sized so that its total loss is affordable.

## What Ironcage is not

- **Not an autonomous AI trader.** The evidence against that design is the reason this project has its shape.
- **Not a prediction engine.** Nothing in the system forecasts prices. The strategy reacts; the regime signal classifies conditions.
- **Not a product.** One operator, one account, personal capital. Simplicity beats generality everywhere they conflict.
- **Not a get-rich scheme.** Anyone promising double-digit monthly returns from a retail bot is selling something. Ironcage's honest good outcome is a system that survives, compounds modestly, and earns the right to more.

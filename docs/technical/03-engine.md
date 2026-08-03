# The engine

The engine is where the product's guarantees become control flow. One SleeveDO per sleeve runs two loops; one SystemDO arbitrates capital; one Workflow per intent carries execution. Everything decision-shaped lives in `@app/core` as pure functions; the DOs are thin schedulers around them.

## The slow tick (candle-aligned)

At each mandate-cadence candle close (+ grace period), a SleeveDO runs, in order:

1. **Freshness check.** Confirm the candle store has the final candle for every instrument; a gap means stand down (telemetry + `warning` event), not evaluate on partial data.
2. **Strategy evaluation.** The mandate's strategy — a pure function `(candles, params, positionState) → signals` from the strategy registry in `@app/core/strategies` — evaluated on *closed* candles only. Signals are entries (each carrying the strategy's own risk weight in [0,1] — this is where volatility-scaled sizing lives), exits, and stop adjustments per instrument.
3. **Trade proposals (Piloted mandates only).** Pending validated `trade_proposals` — at most the mandate's daily budget — join the entry candidates, each carrying its prompt-trace reference. Unconsumed proposals expire at this tick; every consumption or rejection is a feed event with its full verdict.
4. **Attenuation.** Read current grant outputs from D1; compute per-instrument multipliers: staleness-checked, schema-validated, combined by the mandate's combiner (default `min`), clamped to [0,1]. Exits and stops bypass attenuation entirely — risk-reducing actions are never gated.
5. **Sizing.** `positionSize = perSlotEquity × strategyRiskWeight × attenuationMultiplier`, all `BigDecimal`, venue lot/precision applied, clamped by the cage in the next step.
6. **The cage, and reservations.** `evaluateEntry(config, portfolioState, request) → Verdict` — pure, fail-closed (any uncomputable input → `Rejected("state-unavailable")`), collecting *every* violated rule; pair locks checked here. Because the tick is serialized inside the DO, the DO reserves its own sleeve-level headroom (position slots, trade count, daily-loss room) as it approves, then reserves system-cage headroom from SystemDO — so neither sleeve-level nor system-level limits can be raced by concurrent intents. Every verdict — approved or not — is persisted with its intent record and emits its feed event.
7. **Counterfactual legs.** The decision steps re-run in pure code N+1 times: once with *all* attenuators at their control values (the sleeve's no-AI leg, feeding its benchmark), and once per grant with *only that grant* at its control (leave-one-out legs, feeding each grant's own ledger). Differences are recorded to `control_decisions` and later simulated-filled. Attribution interactions (per-grant deltas that don't sum to the joint delta) are reported in the weekly review, not hidden.
8. **Emit.** Approved entries/exits become `OrderIntent`s; each spawns a TradePipeline Workflow run. The tick ends; the DO re-arms its alarm for the next candle.

## The fast tick (1–5 min alarm)

Order management only, no new decisions: sync fills from the gateway (or simulator), enforce unfilled-order timeouts (cancel; partially-filled entries keep the filled part as a live smaller position), reprice resting orders only on a new candle, and escalate an exit that times out repeatedly to an emergency market order. These policies are lifted deliberately from freqtrade's battle-tested lifecycle handling.

**Stop custody:** stops live at the venue wherever supported — the pipeline places a venue stop order when an entry fills (Kraken and Alpaca both support them), so a gateway or engine outage leaves stops armed. The fast tick is the backstop: it verifies venue stops still exist, and monitors last-trade prices (Kraken's public ticker directly; Alpaca's via the gateway) against stop levels for anything a venue stop can't express, escalating through the exit pipeline.

## The trade pipeline (Workflow per intent)

```
step 1  revalidate           — SleeveDO RPC: cage re-check on fresh state +
                                halt/pause epoch check. The DO decides; the
                                Workflow only orchestrates I/O.
step 2  confirm reservation  — SystemDO RPC: the reservation taken at tick
                                time still stands (released ⇒ record, done)
step 3  place                — gateway (live) or fill simulator (dry run),
                                idempotent client order id; a final epoch
                                check immediately precedes the venue call
step 4  await fill           — poll with backoff; every poll observes the
                                halt epoch (halt ⇒ cancel resting entries
                                per winddown)
step 5  blotter write        — via SleeveDO: append orders rows, recompute
                                trades, snapshot equity — serialized
step 6  settle               — confirm/release reservation; emit events
```

Each step has its own retry policy; the client order id makes the whole pipeline idempotent under replay. Both cage evaluations and all blotter mutations execute inside the SleeveDO, preserving the single-writer guarantee — Workflows never write sleeve state directly. **Exit intents (strategy exits, stops, operator flatten, winddown) traverse the same pipeline with `kind: exit`**: they skip entry gating and reservations entirely and are valid in every sleeve state, Halted included — risk-reducing actions are never gated. A pipeline that cannot complete (gateway down mid-flight) parks the sleeve in a `reconciling` flag that the fast tick and scheduled reconciliation clear.

**Halts are epoch-based.** A halt (or pause) increments the SleeveDO's epoch; every venue-touching step revalidates the epoch first, so an in-flight entry cannot land after a halt — "nothing trades anywhere" is enforced against running Workflows, not just future ticks. The SleeveDO owns winddown execution: cancel open orders and, per policy, emit exit intents.

## Dry run: the fill simulator

Dry run is the same pipeline with step 3–4 swapped for `@app/core/sim` — the freqtrade recipe, reimplemented:

- Market orders fill by walking a real order-book snapshot level-by-level to a VWAP, capped at a maximum slippage; the taker fee from the venue's real schedule applies.
- Limit orders rest until the opposite top-of-book actually crosses the price (checked on each poll); resting fills pay maker fees. A limit crossing the spread at placement converts to a market fill.
- Stop orders refuse to be created already-triggered and fill at book-walk VWAP bounded by the stop price when touched.
- The simulated wallet derives from the blotter exactly as live equity does — one code path, different fill source.

Order-book snapshots come from the collector at tick time (top-of-book depth is sufficient at our sizes); when depth is unavailable, the simulator uses last-trade price with a conservative fixed slippage and *marks the fill as degraded* in its record — dry-run honesty is part of the audit surface.

## Reconciliation

On engine start, on schedule (`apps/jobs`), and after any gateway connectivity loss: fetch balances, open orders, and recent fills per venue; compare with what the blotter implies. Venue-side facts the blotter lacks are **adopted** (recorded with `origin: reconciliation` — the operator trading manually at the venue is accounted for, not fought). Blotter-side facts the venue denies are a **mismatch**: sleeve halts (`keep-all`, overriding the mandate's winddown policy — never trade on numbers in dispute), `critical` event, incident report generated. Reconciliation also releases expired system-cage reservations once it verifies no live order references them. It never edits history — it appends corrections.

## Protections

Deterministic post-exit rules writing `pair_locks`, checked by the cage on every entry: cooldown after any close; loss-streak guard (N stoploss exits in a window → lock); sleeve-level drawdown locks. Grant-sourced locks (event vetoes) share the same table and check — one mechanism, several writers, expiry-or-operator removal only.

## The backtester

`@app/core/backtest` drives the identical tick pipeline over archived candles: same strategy functions, same cage, same simulator (order-book snapshots replaced by candle-derived approximations, marked as such), costs always on. Walk-forward is the default harness: parameter fitting on a training window, evaluation on the following window, rolled. Results are hashed (config + code version + data window) and stored to R2; the workbench and gate pipeline consume them. Runtime target: a 4-year, 4h-candle, 2-instrument walk-forward completes within a paid Worker invocation; anything heavier moves to a Container without touching `@app/core`.

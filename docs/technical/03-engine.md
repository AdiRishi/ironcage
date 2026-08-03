# The engine

The engine is where the product's guarantees become control flow. One SleeveDO per sleeve runs two loops; one SystemDO arbitrates capital; one Workflow per intent carries execution. Everything decision-shaped lives in `@app/core` as pure functions; the DOs are thin schedulers around them.

## The slow tick (candle-aligned)

At each mandate-cadence candle close (+ grace period), a SleeveDO runs, in order:

1. **Freshness check.** Confirm the candle store has the final candle for every instrument; a gap means stand down (telemetry + `warning` event), not evaluate on partial data.
2. **Strategy evaluation.** The mandate's strategy — a pure function `(candles, params, positionState) → signals` from the strategy registry in `@app/core/strategies` — evaluated on *closed* candles only. Signals are entries, exits, and stop adjustments per instrument.
3. **Attenuation.** Read current grant outputs from D1; compute per-instrument multipliers: staleness-checked, schema-validated, combined by the mandate's combiner (default `min`), clamped to [0,1]. Exits and stops bypass attenuation entirely — risk-reducing actions are never gated.
4. **Sizing.** `positionSize = tradableEquity / maxConcurrent × multiplier`, all `BigDecimal`, venue lot/precision applied.
5. **The cage.** `evaluateEntry(config, portfolioState, request) → Verdict` — pure, fail-closed (any uncomputable input → `Rejected("state-unavailable")`), collecting *every* violated rule. Pair locks checked here. Every verdict — approved or not — is persisted with its intent record and emits its feed event.
6. **Counterfactual leg.** The same steps re-run with every attenuator forced to its control value (per grant's control definition); differences are recorded to `control_decisions` and later simulated-filled for the value-added ledger. This is a pure-function re-invocation, not a second system.
7. **Emit.** Approved entries/exits become `OrderIntent`s; each spawns a TradePipeline Workflow run. The tick ends; the DO re-arms its alarm for the next candle.

## The fast tick (1–5 min alarm)

Order management only, no new decisions: sync fills from the gateway (or simulator), check stop conditions against latest prices, enforce unfilled-order timeouts (cancel; partially-filled entries keep the filled part as a live smaller position), reprice resting orders only on a new candle, and escalate an exit that times out repeatedly to an emergency market order. These policies are lifted deliberately from freqtrade's battle-tested lifecycle handling.

## The trade pipeline (Workflow per intent)

```
step 1  cage re-check        — fresh portfolio state; a stale in-flight intent
                                cannot slip through a changed world
step 2  system reservation   — SystemDO RPC: reserve exposure headroom
                                (rejected ⇒ record + release, done)
step 3  place                — gateway (live) or fill simulator (dry run),
                                idempotent client order id; retries safe
step 4  await fill           — poll with backoff until filled/canceled/timeout
step 5  blotter write        — orders row + trades recompute + equity snapshot
step 6  settle               — confirm/release reservation; emit events
```

Each step has its own retry policy; the client order id makes the whole pipeline idempotent under replay. A pipeline that cannot complete (gateway down mid-flight) parks the sleeve in a `reconciling` flag that the fast tick and scheduled reconciliation clear.

## Dry run: the fill simulator

Dry run is the same pipeline with step 3–4 swapped for `@app/core/sim` — the freqtrade recipe, reimplemented:

- Market orders fill by walking a real order-book snapshot level-by-level to a VWAP, capped at a maximum slippage; the taker fee from the venue's real schedule applies.
- Limit orders rest until the opposite top-of-book actually crosses the price (checked on each poll); resting fills pay maker fees. A limit crossing the spread at placement converts to a market fill.
- Stop orders refuse to be created already-triggered and fill at book-walk VWAP bounded by the stop price when touched.
- The simulated wallet derives from the blotter exactly as live equity does — one code path, different fill source.

Order-book snapshots come from the collector at tick time (top-of-book depth is sufficient at our sizes); when depth is unavailable, the simulator uses last-trade price with a conservative fixed slippage and *marks the fill as degraded* in its record — dry-run honesty is part of the audit surface.

## Reconciliation

On engine start, on schedule (`apps/jobs`), and after any gateway connectivity loss: fetch balances, open orders, and recent fills per venue; compare with what the blotter implies. Venue-side facts the blotter lacks are **adopted** (recorded with `origin: reconciliation` — the operator trading manually at the venue is accounted for, not fought). Blotter-side facts the venue denies are a **mismatch**: sleeve halts (`keep-all`), `critical` event, incident report generated. Reconciliation never edits history — it appends corrections.

## Protections

Deterministic post-exit rules writing `pair_locks`, checked by the cage on every entry: cooldown after any close; loss-streak guard (N stoploss exits in a window → lock); sleeve-level drawdown locks. Grant-sourced locks (event vetoes) share the same table and check — one mechanism, several writers, expiry-or-operator removal only.

## The backtester

`@app/core/backtest` drives the identical tick pipeline over archived candles: same strategy functions, same cage, same simulator (order-book snapshots replaced by candle-derived approximations, marked as such), costs always on. Walk-forward is the default harness: parameter fitting on a training window, evaluation on the following window, rolled. Results are hashed (config + code version + data window) and stored to R2; the workbench and gate pipeline consume them. Runtime target: a 4-year, 4h-candle, 2-instrument walk-forward completes within a paid Worker invocation; anything heavier moves to a Container without touching `@app/core`.

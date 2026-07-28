# Ironcage — Technical Specification

The [vision](./VISION.md) says why; the [product specification](./PRODUCT.md) says what. This is how: the system that delivers those surfaces. Where this conflicts with either, they win and this document is wrong. Terms are defined in [`CONTEXT.md`](../CONTEXT.md); hard-to-reverse decisions get ADRs in [`docs/adr/`](./adr/AGENTS.md).

## Commitments that bind every document

- **Effect TS end to end.** Services, errors, retries, schedules, and schemas are Effect-native. Contracts are `effect/Schema`; money math is `effect` `BigDecimal` (never floats). When writing Effect code, `.repos/effect/LLMS.md` and the vendored source are the reference.
- **The LLM communicates through the database, not the execution path** (ADR-0001). The regime worker writes a signal row; the engine reads it. There is no network path from any LLM-influenced code to the gateway. The cage is topology, not a permission check.
- **Exchange calls go through a static-IP gateway** (ADR-0002). Workers egress cannot be IP-allowlisted and Binance blocks it outright; a thin signing/forwarding service on a ~$5 static-IP host (reached via Cloudflare Tunnel) is the only component that talks to exchanges. It holds the keys, enforces nothing, and its unavailability halts trading — fail closed.
- **One writer.** The Engine Durable Object is the only component that can decide to trade; DO serialization makes concurrent double-ordering structurally impossible.
- **Same code path everywhere.** `@app/core` is pure and I/O-free; the identical strategy/cage/blotter code runs in the backtester, in dry-run (with the order-book-aware fill simulator at the execution edge), and live (with the gateway). Going live is an edge swap, never a logic change.
- **Blotter-derived state.** Average entry, amounts, realized PnL, and equity are recomputed from the immutable order history on every read that matters. Reconciliation against the exchange runs on startup and periodically; discrepancy halts.

## Architecture

```
CLOUDFLARE
  apps/regime  — Worker, cron (candle-aligned, every 4h)
      context assembly (multiple independent sources)
      → LLM via AI Gateway (Anthropic primary, OpenAI fallback)
      → schema-validated RegimeSignal row + full tick snapshot to R2
  apps/engine  — Worker + Engine Durable Object, alarm-driven
      slow tick (candle close): data refresh → strategy → regime read
        (stale ⇒ OFF) → risk cage → order intents
      fast tick (1–5 min): open-order management, stop checks, fill sync
      trade pipeline: Cloudflare Workflow per intent —
        cage re-check → place (idempotent client order id) → poll fill
        → reconcile → blotter write → notify
  apps/web     — TanStack Start dashboard (read-only over the data)
  D1           — trades, orders, regime_signals, pair_locks,
                 equity_snapshots, llm_ticks
  R2           — candle history (append-only), tick snapshots,
                 backtest artifacts
        │ Cloudflare Tunnel
  gateway (static-IP host, later milestone) — ccxt + HMAC signing,
        zero strategy logic, exchange keys live only here
```

Not yet scaffolded (arrive with their milestones): the Workflow definitions (M2), the gateway service (M4), the backtest runner (M1).

## Domain model

All contracts live in `@app/contracts` as `effect/Schema`:

- **`RegimeSignal`** — `state: ON | HALF | OFF`, confidence, rationale, source digest, `generatedAt`, `staleAfter`. The engine maps state → size multiplier (1.0 / 0.5 / 0) and treats missing/stale as OFF.
- **`OrderIntent`** — pair, side (spot buy/sell only), quantity, type, `clientOrderId` (idempotency key), the originating strategy/regime context, and the cage verdict it passed.
- **`Order` / `Trade`** — freqtrade-inspired: orders keep intended (`ftAmount`/`ftPrice`) separate from exchange-reported (`filled`/`average`/`cost`); trades freeze exchange precision at open and carry stop state, tags, and lifecycle timestamps. Trades are derived from orders (`recalcTradeFromOrders`), never mutated.
- **`RiskConfig`** — the cage: `maxPositionPctPerPair`, `maxConcurrentPositions`, `tradableBalanceRatio`, `hardStopLossPct`, `dailyLossHaltPct`, `maxDrawdownKillPct`, `maxTradesPerDay`, `regimeStaleAfterIntervals`, `allowedPairs`, and the structural flags (`spotOnly`, `noLeverage`). Config lives in code, versioned; changing it is a reviewed commit, not a runtime toggle.
- **`PairLock`** — pair (or `*`), reason, expiry; written by protections (cooldown, stoploss-guard, drawdown), checked before every entry.

## The risk cage

`@app/core/risk/cage` is a pure function: `(config, portfolioState, intent) → Verdict`. `Approved` carries the (possibly clamped) size; `Rejected` carries every violated rule, not just the first — the full verdict is persisted with the intent. Any input that cannot be produced (unknown equity, stale portfolio state) yields `Rejected` with reason `state-unavailable`: fail closed. The cage runs twice per intent — at emission in the engine and again as the first Workflow step — so a stale in-flight intent cannot slip through a changed world.

## Platform notes

- Workers on the paid plan (30s CPU); `nodejs_compat` enabled. Cron granularity is 1 minute; candle-aligned scheduling uses DO alarms computed from candle close, not naive intervals.
- D1 for relational state (free-tier limits exceed hobby needs by orders of magnitude); R2 for bulk history and snapshots; no external Postgres unless analytics outgrow D1 (Hyperdrive makes that additive later).
- AI Gateway fronts all LLM calls: caching, cost tracking, retries, provider fallback. Regime prompts request structured output validated against `RegimeSignal` — a parse failure is a failed tick (⇒ stale ⇒ OFF), never a guess.
- The dashboard reads D1 via server functions in `apps/web`; it holds no secrets and can take no action affecting trading.

## Testing strategy

- `packages/core` is the invariant vault: property-style unit tests on the cage (never approves above caps; fail-closed on missing state) and the blotter (recomputation equals incremental expectation across partial fills, multiple entries, fees).
- The fill simulator gets golden tests against recorded order-book fixtures.
- Dry run _is_ the integration test, run continuously and compared to backtest expectation — divergence is a bug in the simulator, the data, or the strategy's assumptions, and halts promotion up the milestone ladder.

# Architecture

The system is a set of small Cloudflare applications sharing one database, one object store, and one contracts package — plus a deliberately dumb VPS at the edge for exchange calls. Everything below maps one-to-one onto a product concept; nothing exists that the product doesn't name.

## Topology

```
CLOUDFLARE
├─ apps/engine      Worker + Durable Objects
│    SleeveDO (one instance per sleeve, alarm-driven)
│      slow tick @ candle close: data → strategy → attenuators → cage → intents
│      fast tick (1–5 min): open-order management, stop checks, fill sync
│    SystemDO (singleton): capital ledger, allocation acts, system cage,
│      entry reservations, halt-all
│    TradePipeline (Workflow, one run per order intent):
│      cage re-check → system reservation → place (idempotent) → poll fill
│      → reconcile → blotter write → events
├─ apps/grants      Worker (cron): runtime grant ticks
│    regime vector · event veto · risk-officer review → AI Gateway →
│    schema-validate → D1 rows + R2 tick snapshots
│    GatePipeline (Workflow, one run per design-time proposal):
│      validate → reproduce backtest → walk-forward → shadow-run register
│      → waitForEvent(operator approval) → mandate version
├─ apps/collector   Worker (cron): candles from Kraken/Alpaca public APIs
│      → D1 (recent window) + R2 (append-only archive) · gap detection
├─ apps/jobs        Worker (cron): reports (weekly/monthly/trial/incident),
│      reconciliation schedule, D1→R2 backup export, ledger accrual
├─ apps/web         TanStack Start on Workers: the observatory
│      server functions over D1 · SSE liveness via BroadcastDO
│      behind Cloudflare Access
├─ D1               relational state (see 02)
├─ R2               bulk & immutable artifacts (see 02)
└─ AI Gateway       fronts every LLM call: cache, cost, retry, fallback
        │  Cloudflare Tunnel (no inbound ports)
GATEWAY VPS (static IP)
└─ apps/gateway     thin Effect service: signs & forwards venue REST calls
        │
   Kraken (spot, IP-locked keys) · Alpaca (US ETFs, keys held here too)
```

## Why this shape

**One Durable Object per sleeve.** A sleeve's decision loop must be serialized — evaluate, size, check, emit, exactly once per tick. DOs give single-threaded execution with durable alarms, so candle-aligned scheduling (`alarm = next candle close + grace`) and single-writer semantics come from the platform, not from locks we write. Sleeve isolation also falls out naturally: one misbehaving sleeve's DO cannot corrupt another's state.

**One SystemDO above them.** Total-exposure checks, capital movements, and halt-all need a serialized global view. Sleeve DOs call SystemDO (DO-to-DO RPC) to *reserve* entry headroom before emitting an intent; the reservation is confirmed or released by the trade pipeline. This makes system-cage enforcement race-free: two sleeves cannot both squeeze through the last dollar of exposure budget.

**Workflows for anything multi-step that must survive a crash.** Placing an order is a pipeline of fallible steps with retries and idempotency (client order IDs); a design-time proposal is a pipeline of gates ending in a human approval (`waitForEvent`). Cloudflare Workflows give durable, step-level retried execution with state — exactly the shape both need. Queues are reserved for future fan-out needs; nothing uses them at v1.

**The gateway is the only non-Cloudflare piece** (ADR-0002): Workers egress IPs are unpublished and shared, so venue API keys could never be IP-restricted — and key IP-allowlisting (with withdrawals disabled) is the single best security control we have. The VPS runs one small Effect service exposing a private HTTP API over Cloudflare Tunnel: `getBalances`, `getOpenOrders`, `placeOrder`, `cancelOrder`, `getFills`, `getCandles`. It validates shapes, signs requests, forwards, and normalizes responses. It holds the only copies of venue keys, enforces nothing, decides nothing, and its unavailability halts trading — the correct failure mode. Public market data (candles) may be fetched directly from Workers where venues permit; only authenticated calls are bound to the gateway.

## The monorepo

Turborepo + pnpm workspaces, raw-TS workspace packages (no build steps — ADR-style decision carried from the starter):

```
apps/
  web/         TanStack Start (React 19) — the observatory
  engine/      SleeveDO, SystemDO, TradePipeline
  grants/      grant runners + GatePipeline
  collector/   market-data collection
  jobs/        reports, reconciliation schedule, backups
  gateway/     the VPS service (deployed to the VPS, not Cloudflare)
packages/
  contracts/   effect/Schema for every boundary (see 02)
  core/        pure domain logic: strategy interface, cage, sizing,
               blotter recomputation, fill simulator, backtester,
               attenuator composition — zero I/O, runs anywhere
  gateway-client/  typed client for the gateway's API (used by engine only)
scripts/       repo tooling (reference-repo sync)
```

`packages/core` purity is the load-bearing property: the backtester, the dry-run engine, and the live engine execute the *same* strategy/cage/blotter code, differing only in the execution edge injected at the boundary (simulator vs. gateway client). Effect's service/layer system is how those edges are injected.

## Scheduling

Cron Triggers fire the cadence-owning workers (grants, collector, jobs) — coarse, at-least-once, minute-granularity. SleeveDOs self-schedule with DO alarms computed from their mandate's candle boundaries (close + a small grace so venue candles are final). Every tick — fired, skipped, or failed — lands in engine telemetry; a missed tick beyond one full interval degrades the Overview vital.

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
│      revalidate via SleeveDO → confirm reservation → place (idempotent)
│      → poll fill → blotter write via SleeveDO → settle
├─ apps/grants      Worker (cron): runtime grant ticks
│    regime vector · event veto · risk-officer review → AI Gateway →
│    schema-validate → D1 rows + R2 tick snapshots
│    GatePipeline (Workflow, one run per design-time proposal):
│      validate → reproduce backtest → walk-forward → shadow-run register
│      → await the operator's recorded decision → finalize
├─ apps/collector   Worker (cron): candles + top-of-book snapshots
│      Kraken via public endpoints; Alpaca via the gateway (its data
│      API is authenticated — keys never live on Cloudflare)
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

**One SystemDO above them.** Total-exposure checks, capital movements, and halt-all need a serialized global view. During its tick — before any intent is emitted — a SleeveDO calls SystemDO (DO-to-DO RPC) to _reserve_ entry headroom, keyed by the intent's client order id; the trade pipeline later **confirms** the reservation on fill or **releases** it on any terminal failure. Reservations carry a TTL: one that expires unconfirmed is flagged, and the reconciliation pass releases it once it verifies no live order references it — so leaked headroom always fails closed while held and can never be held forever. This makes system-cage enforcement race-free: two sleeves cannot both squeeze through the last dollar of exposure budget.

**Workflows for anything multi-step that must survive a crash.** Placing an order is a pipeline of fallible steps with retries and idempotency (client order IDs); a design-time proposal is a pipeline of gates ending in a human approval (`waitForEvent`). Cloudflare Workflows give durable, step-level retried execution with state — exactly the shape both need. Queues are reserved for future fan-out needs; nothing uses them at v1.

**The gateway is the only non-Cloudflare piece**: Workers egress IPs are unpublished and shared, so venue API keys could never be IP-restricted — and key IP-allowlisting (with withdrawals disabled) is the single best security control we have. The VPS runs one small Effect service exposing a private HTTP API over Cloudflare Tunnel: `getBalances`, `getOpenOrders`, `placeOrder`, `cancelOrder`, `getFills`, `getCandles`. It validates shapes, signs requests, forwards, and normalizes responses. It holds the only copies of venue keys, enforces nothing, decides nothing, and its unavailability halts trading — the correct failure mode. Genuinely public market data (Kraken's OHLC and book endpoints) is fetched directly from Workers; every authenticated call — including Alpaca market data, whose API requires keys even on the free tier — goes through the gateway.

## The monorepo

Turborepo + pnpm workspaces, raw-TS workspace packages — no build steps: `exports` maps point at `./src/*.ts`, every consumer compiles from source, so there is no `dist` to go stale and go-to-definition lands in real code:

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

`packages/core` purity is the load-bearing property: the backtester, the dry-run engine, and the live engine execute the _same_ strategy/cage/blotter code, differing only in the execution edge injected at the boundary (simulator vs. gateway client). Effect's service/layer system is how those edges are injected.

## Scheduling

Cron Triggers fire the cadence-owning workers (grants, collector, jobs) — coarse, at-least-once, minute-granularity. SleeveDOs self-schedule with DO alarms computed from their mandate's candle boundaries (close + a small grace so venue candles are final). Every tick — fired, skipped, or failed — lands in engine telemetry; an overdue tick degrades the Overview vital, and one overdue by more than a full interval marks it failing.
